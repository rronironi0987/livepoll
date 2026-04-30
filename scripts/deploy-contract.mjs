import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  rpc,
} from '@stellar/stellar-sdk'
import { Spec } from '@stellar/stellar-sdk/contract'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function parseRpcUrls() {
  const raw = process.env.STELLAR_RPC_URLS || process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org'
  return String(raw)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

const rpcUrls = parseRpcUrls()
const rpcUrl = rpcUrls[0]
const networkPassphrase = process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET
const wasmPath =
  process.env.STELLAR_WASM_PATH ||
  path.resolve(__dirname, '../poll_contract/target/wasm32v1-none/release/poll_contract.wasm')

const retryAttempts = Number(process.env.STELLAR_RETRY_ATTEMPTS || 7)
const retryBaseDelayMs = Number(process.env.STELLAR_RETRY_DELAY_MS || 650)
const timeoutMs = Number(process.env.STELLAR_TIMEOUT_MS || 20000)

function isRetryableAxiosError(error) {
  const code = error?.code || error?.cause?.code
  if (code && ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)) {
    return true
  }

  const status = error?.response?.status
  if (typeof status === 'number' && status >= 500) {
    return true
  }

  return false
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetry(label, operation) {
  let lastError = null

  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!isRetryableAxiosError(error) || attempt === retryAttempts) {
        throw error
      }

      const jitter = Math.floor(Math.random() * 180)
      const delay = retryBaseDelayMs * attempt + jitter
      console.warn(`${label} failed (${error.code || 'unknown'}). Retrying in ${delay}ms...`)
      await sleep(delay)
    }
  }

  throw lastError
}

async function createRpcServer() {
  let lastError = null

  for (const candidate of rpcUrls) {
    const candidateServer = new rpc.Server(candidate, { timeout: timeoutMs })

    try {
      await withRetry(`rpc.getNetwork(${candidate})`, () => candidateServer.getNetwork())
      return { server: candidateServer, rpcUrl: candidate }
    } catch (error) {
      lastError = error
    }
  }

  const details = lastError?.message || lastError?.code || String(lastError || 'unknown error')
  throw new Error(`Unable to connect to Soroban RPC. Tried: ${rpcUrls.join(', ')}. Last error: ${details}`)
}

const { server, rpcUrl: resolvedRpcUrl } = await createRpcServer()
const wasm = fs.readFileSync(wasmPath)
const spec = Spec.fromWasm(wasm)

function fail(message) {
  throw new Error(message)
}

function toHex(bytes) {
  return Buffer.from(bytes).toString('hex')
}

async function getSourceKeypair() {
  const secret = process.env.STELLAR_DEPLOYER_SECRET
  if (secret) {
    return { keypair: Keypair.fromSecret(secret), generated: false }
  }

  const generated = Keypair.random()
  await withRetry('rpc.fundAddress', () => server.fundAddress(generated.publicKey()))
  return { keypair: generated, generated: true }
}

async function sendOperation(sourceKeypair, operation) {
  const account = await withRetry('rpc.getAccount', () => server.getAccount(sourceKeypair.publicKey()))

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(60)
    .build()

  const prepared = await withRetry('rpc.prepareTransaction', () => server.prepareTransaction(tx))
  prepared.sign(sourceKeypair)

  const submission = await withRetry('rpc.sendTransaction', () => server.sendTransaction(prepared))
  if (submission.status === 'ERROR' || submission.status === 'TRY_AGAIN_LATER') {
    fail(`Submission failed with status ${submission.status}.`)
  }

  const finalResult = await withRetry('rpc.pollTransaction', () =>
    server.pollTransaction(submission.hash, {
      attempts: 40,
      sleepStrategy: () => 1500,
    }),
  )

  if (finalResult.status !== 'SUCCESS') {
    fail(`Network rejected the transaction with status ${finalResult.status}.`)
  }

  return {
    hash: submission.hash,
    returnValue: finalResult.returnValue,
  }
}

async function uploadContractWasm(sourceKeypair) {
  const result = await sendOperation(
    sourceKeypair,
    Operation.uploadContractWasm({ wasm }),
  )

  if (!result.returnValue) {
    fail('Upload succeeded but did not return a wasm hash.')
  }

  return {
    hash: result.hash,
    wasmHash: result.returnValue.bytes(),
  }
}

async function deployContract(sourceKeypair, wasmHash, saltHex) {
  const result = await sendOperation(
    sourceKeypair,
    Operation.createCustomContract({
      wasmHash,
      address: Address.fromString(sourceKeypair.publicKey()),
      salt: Buffer.from(saltHex, 'hex'),
    }),
  )

  if (!result.returnValue) {
    fail('Deploy succeeded but did not return a contract address.')
  }

  const contractId = StrKey.encodeContract(
    Address.fromScAddress(result.returnValue.address()).toBuffer(),
  )

  return {
    hash: result.hash,
    contractId,
  }
}

async function invokeCreatePoll(sourceKeypair, contractId) {
  const account = await withRetry('rpc.getAccount(sample)', () => server.getAccount(sourceKeypair.publicKey()))
  const contract = new Contract(contractId)
  const args = spec.funcArgsToScVals('create_poll', {
    creator: sourceKeypair.publicKey(),
    question: 'Which feature should ship next?',
    options: ['Mobile support', 'Analytics dashboard', 'Theme presets'],
    duration_minutes: 120,
  })

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call('create_poll', ...args))
    .setTimeout(60)
    .build()

  const prepared = await withRetry('rpc.prepareTransaction(sample)', () => server.prepareTransaction(tx))
  prepared.sign(sourceKeypair)

  const submission = await withRetry('rpc.sendTransaction(sample)', () => server.sendTransaction(prepared))
  if (submission.status === 'ERROR' || submission.status === 'TRY_AGAIN_LATER') {
    fail(`Sample contract call failed with status ${submission.status}.`)
  }

  const finalResult = await withRetry('rpc.pollTransaction(sample)', () =>
    server.pollTransaction(submission.hash, {
      attempts: 40,
      sleepStrategy: () => 1500,
    }),
  )

  if (finalResult.status !== 'SUCCESS') {
    fail(`Sample contract call ended with status ${finalResult.status}.`)
  }

  return submission.hash
}

async function main() {
  const { keypair, generated } = await getSourceKeypair()
  const upload = await uploadContractWasm(keypair)
  const deployment = await deployContract(keypair, upload.wasmHash, upload.hash)
  const sampleCallHash = await invokeCreatePoll(keypair, deployment.contractId)

  const output = {
    rpcUrl: resolvedRpcUrl,
    networkPassphrase,
    deployerPublicKey: keypair.publicKey(),
    deployerSecret: generated ? keypair.secret() : 'provided-via-env',
    uploadTxHash: upload.hash,
    wasmHash: toHex(upload.wasmHash),
    deployTxHash: deployment.hash,
    contractId: deployment.contractId,
    sampleCreatePollTxHash: sampleCallHash,
  }

  console.log(JSON.stringify(output, null, 2))
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
