import { Buffer } from 'buffer'
import {
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  Address,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk'
import { Spec } from '@stellar/stellar-sdk/contract'
import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  FREIGHTER_ID,
} from '@creit.tech/stellar-wallets-kit'
import {
  getAddress as getFreighterAddress,
  requestAccess as requestFreighterAccess,
} from '@stellar/freighter-api'
import pollContractWasmUrl from '../../poll_contract/target/wasm32v1-none/release/poll_contract.wasm?url'

if (!globalThis.Buffer) {
  globalThis.Buffer = Buffer
}

const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org'
const DEFAULT_CONTRACT_ID = 'CBGJGJOFFSY5KK7DHFENNBGASXROVG5GEW2MISGJ2N2F7VLHCCUJ42UA'
const READ_ACCOUNT_STORAGE_KEY = 'livepoll_read_account'

export const RPC_URL = import.meta.env.VITE_STELLAR_RPC_URL || DEFAULT_RPC_URL
export const NETWORK_PASSPHRASE =
  import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET
export const CONTRACT_ID = import.meta.env.VITE_STELLAR_CONTRACT_ID || DEFAULT_CONTRACT_ID
export const EXPLORER_BASE_URL =
  import.meta.env.VITE_STELLAR_EXPLORER_URL || 'https://stellar.expert/explorer/testnet'

export const SUPPORTED_WALLET_NAMES = [
  'xBull',
  'Freighter',
  'Albedo',
  'Rabet',
  'Lobstr',
  'Hana',
  'Hot Wallet',
  'Klever',
]

export const server = new rpc.Server(RPC_URL)

export const walletKit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  modules: allowAllModules(),
})

let specPromise

function ensureContractConfigured() {
  if (!CONTRACT_ID) {
    throw new Error(
      'Missing VITE_STELLAR_CONTRACT_ID. Add your deployed testnet contract id to the frontend env.',
    )
  }
}

function toDisplayString(value) {
  if (value == null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (typeof value?.toString === 'function') {
    return value.toString()
  }

  return String(value)
}

function toNumber(value) {
  if (typeof value === 'number') {
    return value
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  return Number(value || 0)
}

function normalizeEventAction(action) {
  const normalized = toDisplayString(action).toLowerCase()

  if (normalized === 'create' || normalized === 'vote' || normalized === 'close') {
    return normalized
  }

  return 'update'
}

function normalizeContractEvent(event) {
  const topic = (event.topic || []).map((item) => scValToNative(item))
  const value = event.value ? scValToNative(event.value) : null
  const action = normalizeEventAction(topic[1])
  const pollId = toNumber(topic[2])

  let title = 'Contract update detected'
  let summary = `Poll #${pollId} changed on-chain.`

  if (action === 'create') {
    title = 'Poll created'
    summary = `Poll #${pollId} was created on-chain.`
  }

  if (action === 'vote') {
    title = 'Vote received'
    summary = `Poll #${pollId} recorded a vote for option ${toNumber(value) + 1}.`
  }

  if (action === 'close') {
    title = 'Poll closed'
    summary = `Poll #${pollId} was closed on-chain.`
  }

  return {
    id: event.id,
    action,
    pollId,
    title,
    summary,
    ledger: event.ledger,
    ledgerClosedAt: event.ledgerClosedAt,
    txHash: event.txHash,
  }
}

export function getExplorerLink(type, value) {
  return `${EXPLORER_BASE_URL}/${type}/${value}`
}

export async function getContractSpec() {
  if (!specPromise) {
    specPromise = fetch(pollContractWasmUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error('Unable to load the compiled poll contract wasm.')
        }

        return response.arrayBuffer()
      })
      .then((buffer) => Spec.fromWasm(Buffer.from(buffer)))
  }

  return specPromise
}

export async function ensureReadAccount() {
  const configuredAddress = import.meta.env.VITE_STELLAR_READ_ACCOUNT
  if (configuredAddress) {
    return configuredAddress
  }

  const storedAddress = window.localStorage.getItem(READ_ACCOUNT_STORAGE_KEY)
  if (storedAddress) {
    try {
      await server.getAccount(storedAddress)
      return storedAddress
    } catch {
      window.localStorage.removeItem(READ_ACCOUNT_STORAGE_KEY)
    }
  }

  const keypair = Keypair.random()
  await server.fundAddress(keypair.publicKey())
  window.localStorage.setItem(READ_ACCOUNT_STORAGE_KEY, keypair.publicKey())
  return keypair.publicKey()
}

async function buildInvocation({ sourceAddress, method, args = {} }) {
  ensureContractConfigured()
  const spec = await getContractSpec()
  const account = await server.getAccount(sourceAddress)
  const contract = new Contract(CONTRACT_ID)
  const scArgs = spec.funcArgsToScVals(method, args)

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...scArgs))
    .setTimeout(60)
    .build()

  return { spec, tx }
}

function extractSimulationError(simulation) {
  if (rpc.Api.isSimulationError(simulation)) {
    return simulation.error
  }

  return 'Transaction simulation failed.'
}

function extractSubmissionError(reply) {
  if (!reply) {
    return 'The transaction could not be submitted.'
  }

  if (typeof reply === 'string') {
    return reply
  }

  if (reply.errorResult?.switch) {
    return `Submission failed: ${reply.errorResult.switch().name}.`
  }

  if (reply.status) {
    return `Submission failed with status ${reply.status}.`
  }

  return reply.message || 'The transaction could not be submitted.'
}

function extractPolledFailure(reply) {
  if (!reply) {
    return 'The network did not confirm the transaction.'
  }

  if (reply.status === 'NOT_FOUND') {
    return 'The transaction was submitted but was not found before polling timed out.'
  }

  if (reply.resultXdr?.result?.()?.switch) {
    return `Transaction failed: ${reply.resultXdr.result().switch().name}.`
  }

  return 'The network rejected the transaction.'
}

export async function callContractRead(method, args = {}, sourceAddress) {
  const readAddress = sourceAddress || (await ensureReadAccount())
  const { spec, tx } = await buildInvocation({ sourceAddress: readAddress, method, args })
  const simulation = await server.simulateTransaction(tx)

  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(extractSimulationError(simulation))
  }

  const result = simulation.result?.retval
  if (!result) {
    return null
  }

  return spec.funcResToNative(method, result)
}

export function normalizePoll(contractPoll) {
  return {
    id: toNumber(contractPoll.id),
    question: toDisplayString(contractPoll.question),
    options: (contractPoll.options || []).map((option) => toDisplayString(option)),
    votes: (contractPoll.votes || []).map((vote) => toNumber(vote)),
    createdAt: toNumber(contractPoll.created_at) * 1000,
    expiresAt: toNumber(contractPoll.expires_at) * 1000,
    creator: toDisplayString(contractPoll.creator),
    active: Boolean(contractPoll.active),
  }
}

export async function fetchPolls(sourceAddress) {
  const rawPolls = await callContractRead('get_polls', {}, sourceAddress)
  return (rawPolls || []).map(normalizePoll)
}

export async function fetchVoteStatuses(polls, voterAddress, sourceAddress) {
  if (!voterAddress || polls.length === 0) {
    return {}
  }

  const voteEntries = await Promise.all(
    polls.map(async (poll) => {
      const hasVoted = await callContractRead(
        'has_voted',
        { poll_id: poll.id, voter: Address.fromString(voterAddress) },
        sourceAddress,
      )

      return [poll.id, Boolean(hasVoted)]
    }),
  )

  return Object.fromEntries(voteEntries)
}

export async function fetchContractEvents(cursor) {
  ensureContractConfigured()

  const filters = [{ type: 'contract', contractIds: [CONTRACT_ID] }]

  if (cursor) {
    const response = await server.getEvents({ filters, cursor, limit: 20 })

    return {
      ...response,
      events: response.events.map(normalizeContractEvent),
    }
  }

  const latestLedger = await server.getLatestLedger()
  const startLedger = Math.max(latestLedger.sequence - 2, 1)
  const response = await server.getEvents({ filters, startLedger, limit: 20 })

  return {
    ...response,
    events: response.events.map(normalizeContractEvent),
  }
}

export async function connectWallet() {
  return new Promise((resolve, reject) => {
    walletKit
      .openModal({
        modalTitle: 'Choose a Stellar wallet',
        notAvailableText: 'Install a Stellar wallet to create and vote on-chain.',
        onWalletSelected: async (walletOption) => {
          try {
            walletKit.setWallet(walletOption.id)
            let address = ''

            if (walletOption.id === FREIGHTER_ID) {
              const accessResponse = await requestFreighterAccess()
              if (accessResponse.error) {
                throw accessResponse.error
              }

              address = accessResponse.address

              if (!address) {
                const freighterAddressResponse = await getFreighterAddress()
                if (freighterAddressResponse.error) {
                  throw freighterAddressResponse.error
                }

                address = freighterAddressResponse.address
              }
            } else {
              const response = await walletKit.getAddress()
              address = response.address
            }

            if (!address) {
              throw new Error('The selected wallet did not return a public address.')
            }

            resolve({
              address,
              walletId: walletOption.id,
              walletName: walletOption.name || walletOption.productName || 'Wallet',
            })
          } catch (error) {
            reject(error)
          }
        },
        onClosed: (error) => {
          reject(error || new Error('The wallet request was closed before finishing.'))
        },
      })
      .catch(reject)
  })
}

export async function disconnectWallet() {
  try {
    await walletKit.disconnect?.()
  } catch {
    // Best effort only. Some wallet modules do not expose disconnect behavior.
  }
}

export async function submitContractTransaction({
  method,
  args,
  address,
  onStatus,
}) {
  const { tx } = await buildInvocation({ sourceAddress: address, method, args })
  onStatus?.({ phase: 'preparing' })

  const prepared = await server.prepareTransaction(tx)
  onStatus?.({ phase: 'awaiting-signature' })

  const { signedTxXdr } = await walletKit.signTransaction(prepared.toXDR(), {
    address,
    networkPassphrase: NETWORK_PASSPHRASE,
  })

  const signedTx = TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE)
  const submission = await server.sendTransaction(signedTx)

  if (submission.status === 'ERROR' || submission.status === 'TRY_AGAIN_LATER') {
    throw new Error(extractSubmissionError(submission))
  }

  onStatus?.({
    phase: 'pending',
    hash: submission.hash,
    latestLedger: submission.latestLedger,
  })

  const finalResult = await server.pollTransaction(submission.hash, {
    attempts: 40,
    sleepStrategy: () => 1500,
  })

  if (finalResult.status !== 'SUCCESS') {
    throw new Error(extractPolledFailure(finalResult))
  }

  onStatus?.({
    phase: 'success',
    hash: submission.hash,
    ledger: finalResult.ledger,
  })

  return finalResult
}
