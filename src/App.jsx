import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'
import {
  connectWallet,
  CONTRACT_ID,
  disconnectWallet,
  ensureReadAccount,
  fetchContractEvents,
  fetchPolls,
  fetchVoteStatuses,
  getExplorerLink,
  NETWORK_PASSPHRASE,
  RPC_URL,
  submitContractTransaction,
  SUPPORTED_WALLET_NAMES,
} from './lib/stellar'
import { readCachedPolls, removeCachedPoll, writeCachedPolls } from './lib/pollCache'
import { getPollState, mergeRecentEvents, parsePollHash } from './lib/pollLogic'

const EMPTY_FORM = {
  question: '',
  options: ['', ''],
  duration: 60,
}

const DURATION_PRESETS = [5, 15, 30, 60, 180, 1440]
const THEME_STORAGE_KEY = 'livepoll-theme'
const POLL_VIEW_STORAGE_KEY = 'livepoll-poll-view'

function getInitialTheme() {
  if (typeof window === 'undefined') {
    return 'light'
  }

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') {
      return stored
    }
  } catch {
    // Ignore storage failures.
  }

  if (window.matchMedia?.('(prefers-color-scheme: dark)')?.matches) {
    return 'dark'
  }

  return 'light'
}

function getInitialPollView() {
  if (typeof window === 'undefined') {
    return 'grid'
  }

  try {
    const stored = window.localStorage.getItem(POLL_VIEW_STORAGE_KEY)
    if (stored === 'grid' || stored === 'list') {
      return stored
    }
  } catch {
    // Ignore storage failures.
  }

  return 'grid'
}

function applyTheme(theme) {
  if (typeof document === 'undefined') {
    return
  }

  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Ignore storage failures.
  }
}

function ThemeIcon({ theme }) {
  if (theme === 'dark') {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path
          d="M21 12.8a7.7 7.7 0 0 1-10.6-10A8.9 8.9 0 1 0 21 12.8Z"
          fill="currentColor"
        />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0-16v2m0 16v2m10-10h-2M4 12H2m16.95 6.95-1.41-1.41M6.46 6.46 5.05 5.05m13.9 0-1.41 1.41M6.46 17.54l-1.41 1.41"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ViewIcon({ view }) {
  if (view === 'list') {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path
          d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path
        d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function shortenAddress(address) {
  if (!address) {
    return 'Not connected'
  }

  return `${address.slice(0, 6)}...${address.slice(-6)}`
}

function formatDateTime(timestamp) {
  if (!timestamp) {
    return 'Waiting for sync'
  }

  if (typeof timestamp === 'string') {
    return new Date(timestamp).toLocaleString()
  }

  return new Date(timestamp).toLocaleString()
}

function formatEventTime(timestamp) {
  if (!timestamp) {
    return 'Pending ledger timestamp'
  }

  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatTimeLeft(expiresAt) {
  const diff = expiresAt - Date.now()
  if (diff <= 0) {
    return 'Closed'
  }

  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return `${days}d ${hours % 24}h left`
  }

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m left`
  }

  return `${minutes}m left`
}

function getVoteActionState({ poll, walletAddress, hasVoted, transactionPhase, isWalletBusy }) {
  if (!walletAddress) {
    return {
      label: isWalletBusy ? 'Opening wallets...' : 'Connect wallet to vote',
      disabled: isWalletBusy,
      action: 'connect',
    }
  }

  if (getPollState(poll) === 'closed') {
    return {
      label: 'Poll closed',
      disabled: true,
      action: 'closed',
    }
  }

  if (hasVoted) {
    return {
      label: 'Already voted',
      disabled: true,
      action: 'voted',
    }
  }

  if (transactionPhase === 'preparing' || transactionPhase === 'awaiting-signature' || transactionPhase === 'pending') {
    return {
      label: 'Submitting...',
      disabled: true,
      action: 'pending',
    }
  }

  return {
    label: 'Vote',
    disabled: false,
    action: 'vote',
  }
}

function getCreatePollActionState({ walletAddress, transactionPhase, isWalletBusy }) {
  if (!walletAddress) {
    return {
      label: isWalletBusy ? 'Opening wallets...' : 'Connect wallet to create',
      disabled: isWalletBusy,
      action: 'connect',
    }
  }

  if (
    transactionPhase === 'preparing' ||
    transactionPhase === 'awaiting-signature' ||
    transactionPhase === 'pending'
  ) {
    return {
      label: 'Submitting...',
      disabled: true,
      action: 'pending',
    }
  }

  return {
    label: 'Create on-chain poll',
    disabled: false,
    action: 'create',
  }
}

function normalizeAddress(address) {
  return String(address || '').trim().toUpperCase()
}

function isPollOwner(poll, walletAddress) {
  return normalizeAddress(walletAddress) !== '' && normalizeAddress(walletAddress) === normalizeAddress(poll?.creator)
}

function getTransactionCopy(transaction) {
  switch (transaction?.phase) {
    case 'preparing':
      return 'Simulating the contract call and preparing the transaction.'
    case 'awaiting-signature':
      return 'Waiting for your wallet to review and sign the transaction.'
    case 'pending':
      return 'Submitted to Stellar testnet. Waiting for final confirmation.'
    case 'success':
      return 'Confirmed on-chain. Poll data is refreshing from contract events.'
    case 'error':
      return transaction.message
    default:
      return 'No transaction yet. Create a poll, vote, or close a poll to see on-chain status here.'
  }
}

function classifyError(error) {
  const rawMessage = error?.message || String(error || 'Unknown error')
  const message = rawMessage.toLowerCase()

  if (
    message.includes('not installed') ||
    message.includes('not available') ||
    message.includes('wallet not found') ||
    message.includes('missing wallet')
  ) {
    return {
      title: 'Wallet not found',
      message: 'Install Freighter, xBull, Albedo, or another supported Stellar wallet and try again.',
    }
  }

  if (
    message.includes('rejected') ||
    message.includes('declined') ||
    message.includes('denied') ||
    message.includes('closed before finishing') ||
    message.includes('cancelled')
  ) {
    return {
      title: 'Wallet request rejected',
      message: 'The wallet request was cancelled before it could sign the transaction.',
    }
  }

  if (
    message.includes('insufficient') ||
    message.includes('underfunded') ||
    message.includes('below reserve') ||
    message.includes('balance')
  ) {
    return {
      title: 'Insufficient balance',
      message: 'The connected wallet does not have enough testnet XLM to pay for the contract transaction.',
    }
  }

  if (message.includes('account not found')) {
    return {
      title: 'Testnet wallet not funded',
      message:
        'This wallet address does not exist on Stellar testnet yet. Fund it with Friendbot before sending contract transactions.',
    }
  }

  if (message.includes('already voted')) {
    return {
      title: 'Vote already recorded',
      message: 'This wallet has already voted on the selected poll.',
    }
  }

  if (message.includes('pollinactive') || message.includes('poll inactive')) {
    return {
      title: 'Poll already closed',
      message: 'This poll is no longer accepting votes.',
    }
  }

  if (message.includes('pollexpired') || message.includes('expired')) {
    return {
      title: 'Poll expired',
      message: 'The selected poll already expired on-chain.',
    }
  }

  if (message.includes('missing vite_stellar_contract_id')) {
    return {
      title: 'Contract configuration missing',
      message: rawMessage,
    }
  }

  return {
    title: 'Something went wrong',
    message: rawMessage,
  }
}

function App() {
  const [theme, setTheme] = useState(getInitialTheme)
  const [wallet, setWallet] = useState(null)
  const [polls, setPolls] = useState(() => readCachedPolls())
  const [voteLookup, setVoteLookup] = useState({})
  const [selectedPollId, setSelectedPollId] = useState(null)
  const [filter, setFilter] = useState('all')
  const [sortBy, setSortBy] = useState('ending-soon')
  const [searchQuery, setSearchQuery] = useState('')
  const [pollView, setPollView] = useState(getInitialPollView)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [bootError, setBootError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [isBooting, setIsBooting] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isWalletBusy, setIsWalletBusy] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState(null)
  const [transaction, setTransaction] = useState({ phase: 'idle' })
  const [recentEvents, setRecentEvents] = useState([])

  const eventCursorRef = useRef(null)
  const refreshPollStateRef = useRef(null)
  const syncFromEventsRef = useRef(null)
  const deferredSearch = useDeferredValue(searchQuery)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    try {
      window.localStorage.setItem(POLL_VIEW_STORAGE_KEY, pollView)
    } catch {
      // Ignore storage failures.
    }
  }, [pollView])

  const selectedPoll = useMemo(
    () => polls.find((poll) => poll.id === selectedPollId) || null,
    [polls, selectedPollId],
  )
  const selectedPollState = selectedPoll ? getPollState(selectedPoll) : null
  const selectedPollTotalVotes = selectedPoll
    ? selectedPoll.votes.reduce((sum, vote) => sum + vote, 0)
    : 0
  const createPollAction = useMemo(
    () =>
      getCreatePollActionState({
        walletAddress: wallet?.address,
        transactionPhase: transaction.phase,
        isWalletBusy,
      }),
    [isWalletBusy, transaction.phase, wallet?.address],
  )

  const visiblePolls = useMemo(() => {
    const filtered = polls
      .filter((poll) => {
        const state = getPollState(poll)
        if (filter === 'active' && state !== 'active') {
          return false
        }

        if (filter === 'closed' && state !== 'closed') {
          return false
        }

        const query = deferredSearch.trim().toLowerCase()
        if (!query) {
          return true
        }

        return (
          poll.question.toLowerCase().includes(query) ||
          poll.options.some((option) => option.toLowerCase().includes(query))
        )
      })
      .sort((left, right) => {
        if (sortBy === 'most-votes') {
          const leftVotes = left.votes.reduce((sum, vote) => sum + vote, 0)
          const rightVotes = right.votes.reduce((sum, vote) => sum + vote, 0)
          return rightVotes - leftVotes
        }

        if (sortBy === 'newest') {
          return right.createdAt - left.createdAt
        }

        if (sortBy === 'oldest') {
          return left.createdAt - right.createdAt
        }

        return left.expiresAt - right.expiresAt
      })

    return filtered
  }, [deferredSearch, filter, polls, sortBy])

  const stats = useMemo(() => {
    const activePolls = polls.filter((poll) => getPollState(poll) === 'active').length
    const totalVotes = polls.reduce(
      (sum, poll) => sum + poll.votes.reduce((voteSum, vote) => voteSum + vote, 0),
      0,
    )

    return {
      totalPolls: polls.length,
      activePolls,
      totalVotes,
    }
  }, [polls])

  useEffect(() => {
    if (!notice) {
      return undefined
    }

    const timer = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    writeCachedPolls(polls)
  }, [polls])

  function showNotice(type, title, message) {
    setNotice({ type, title, message })
  }

  function handleFailure(error, txPhase = 'error') {
    const parsed = classifyError(error)
    setTransaction((current) => ({
      ...current,
      phase: txPhase,
      message: parsed.message,
    }))
    showNotice('error', parsed.title, parsed.message)
    return parsed
  }

  async function refreshPollState({ silent = false } = {}) {
    if (!CONTRACT_ID) {
      setBootError({
        title: 'Contract configuration missing',
        message:
          'Add VITE_STELLAR_CONTRACT_ID to your frontend env so the app can read and write to the deployed poll contract.',
      })
      setIsBooting(false)
      return
    }

    if (!silent) {
      setIsRefreshing(true)
    }

    try {
      const readAddress = await ensureReadAccount()
      const nextPolls = await fetchPolls(readAddress)
      const nextVotes = await fetchVoteStatuses(nextPolls, wallet?.address, readAddress)

      setPolls(nextPolls)
      setVoteLookup(nextVotes)

      window.setTimeout(() => {
        setLastSyncedAt(new window.Date().toISOString())
      }, 0)
      setBootError(null)

      const hashPollId = parsePollHash(window.location.hash)
      if (hashPollId && nextPolls.some((poll) => poll.id === hashPollId)) {
        setSelectedPollId(hashPollId)
      } else if (selectedPollId && !nextPolls.some((poll) => poll.id === selectedPollId)) {
        setSelectedPollId(null)
      }
    } catch (error) {
      const parsed = classifyError(error)
      setBootError(parsed)
      if (!silent) {
        showNotice('error', parsed.title, parsed.message)
      }
    } finally {
      setIsBooting(false)
      setIsRefreshing(false)
    }
  }

  async function syncFromEvents() {
    if (!CONTRACT_ID) {
      return
    }

    try {
      const eventBatch = await fetchContractEvents(eventCursorRef.current)
      eventCursorRef.current = eventBatch.cursor

      if (eventBatch.events.length > 0) {
        setRecentEvents((current) => mergeRecentEvents(current, eventBatch.events))
        await refreshPollState({ silent: true })
      }
    } catch {
      // Background event polling should not interrupt the main UX.
    }
  }

  useEffect(() => {
    refreshPollStateRef.current = refreshPollState
    syncFromEventsRef.current = syncFromEvents
  })

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refreshPollStateRef.current?.()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [selectedPollId, wallet?.address])

  useEffect(() => {
    if (!CONTRACT_ID) {
      return undefined
    }

    const interval = window.setInterval(() => {
      syncFromEventsRef.current?.()
    }, 5000)

    return () => window.clearInterval(interval)
  }, [selectedPollId, wallet?.address])

  useEffect(() => {
    const syncSelectedPollFromHash = () => {
      const pollId = parsePollHash(window.location.hash)
      if (pollId) {
        setSelectedPollId(pollId)
      }
    }

    syncSelectedPollFromHash()
    window.addEventListener('hashchange', syncSelectedPollFromHash)

    return () => window.removeEventListener('hashchange', syncSelectedPollFromHash)
  }, [])

  function setPollHash(pollId) {
    window.history.replaceState(null, '', `#poll-${pollId}`)
  }

  function clearPollHash() {
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${window.location.search}`,
    )
  }

  function openPollDetails(pollId) {
    setSelectedPollId(pollId)
    setPollHash(pollId)
  }

  function dismissSelectedPoll() {
    setSelectedPollId(null)
    clearPollHash()
  }

  async function handleConnectWallet() {
    setIsWalletBusy(true)

    try {
      const connectedWallet = await connectWallet()
      setWallet(connectedWallet)
      showNotice(
        'success',
        'Wallet connected',
        `${connectedWallet.walletName} is ready to create polls and sign votes on testnet.`,
      )
    } catch (error) {
      handleFailure(error)
    } finally {
      setIsWalletBusy(false)
    }
  }

  async function handleDisconnectWallet() {
    await disconnectWallet()
    setWallet(null)
    setVoteLookup({})
    showNotice('info', 'Wallet disconnected', 'You can still read polls while disconnected.')
  }

  function updateTransactionStatus(update) {
    setTransaction((current) => ({ ...current, ...update }))
  }

  async function handleMenuDeletePoll(pollId) {
    if (!window.confirm(`Delete poll #${pollId}? This removes it from the contract and stored cache.`)) {
      return
    }

    await handleDeletePoll(pollId)
  }

  async function runContractWrite(method, args, successTitle, successMessage) {
    if (!wallet?.address) {
      showNotice('error', 'Wallet required', 'Connect a Stellar wallet before sending a contract transaction.')
      return false
    }

    try {
      await submitContractTransaction({
        method,
        args,
        address: wallet.address,
        onStatus: updateTransactionStatus,
      })

      showNotice('success', successTitle, successMessage)
      await refreshPollState({ silent: true })
      return true
    } catch (error) {
      handleFailure(error)
      return false
    }
  }

  async function handleCreatePoll() {
    const walletAddress = wallet?.address

    if (!walletAddress) {
      showNotice('error', 'Wallet required', 'Connect a Stellar wallet before creating a poll.')
      return
    }

    const question = form.question.trim()
    const options = form.options.map((option) => option.trim()).filter(Boolean)

    if (!question) {
      setFormError('Enter a poll question before creating it on-chain.')
      return
    }

    if (options.length < 2) {
      setFormError('Provide at least two answer options.')
      return
    }

    setFormError('')

    const created = await runContractWrite(
      'create_poll',
      {
        creator: walletAddress,
        question,
        options,
        duration_minutes: Number(form.duration),
      },
      'Poll created',
      'Your poll was deployed to the contract and will appear after the next sync.',
    )

    if (created) {
      setForm(EMPTY_FORM)
    }
  }

  async function handleVote(pollId, optionIndex) {
    const walletAddress = wallet?.address

    await runContractWrite(
      'vote',
      {
        voter: walletAddress,
        poll_id: pollId,
        option_index: optionIndex,
      },
      'Vote submitted',
      'Your vote was written to the contract and the UI is syncing the latest totals.',
    )
  }

  async function handleClosePoll(pollId) {
    const walletAddress = wallet?.address

    await runContractWrite(
      'close_poll',
      {
        poll_id: pollId,
        caller: walletAddress,
      },
      'Poll closed',
      'The contract marked this poll as inactive.',
    )
  }

  async function handleDeletePoll(pollId) {
    const walletAddress = wallet?.address

    const deleted = await runContractWrite(
      'delete_poll',
      {
        poll_id: pollId,
        caller: walletAddress,
      },
      'Poll deleted',
      'The contract removed this poll and the UI is syncing the latest list.',
    )

    if (deleted) {
      removeCachedPoll(pollId)
      setPolls((current) => current.filter((poll) => poll.id !== pollId))
      setVoteLookup((current) => {
        const next = { ...current }
        delete next[pollId]
        return next
      })

      if (selectedPollId === pollId) {
        setSelectedPollId(null)
        clearPollHash()
      }
    }
  }

  function addOption() {
    setForm((current) => ({
      ...current,
      options: current.options.length >= 6 ? current.options : [...current.options, ''],
    }))
  }

  function updateOption(index, value) {
    setForm((current) => ({
      ...current,
      options: current.options.map((option, optionIndex) =>
        optionIndex === index ? value : option,
      ),
    }))
  }

  function removeOption(index) {
    setForm((current) => ({
      ...current,
      options:
        current.options.length <= 2
          ? current.options
          : current.options.filter((_, optionIndex) => optionIndex !== index),
    }))
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <header className="topbar">
        <div>
          <p className="eyebrow">Stellar Level 2</p>
          <h1>LivePoll Testnet Control Room</h1>
          <p className="subtitle">
            Multi-wallet voting, contract-backed poll storage, live event sync, and
            visible transaction state on Stellar testnet.
          </p>
        </div>

        <div className="topbar-actions">
          <div className="network-pill">
            <span className="status-dot" />
            {NETWORK_PASSPHRASE === 'Test SDF Network ; September 2015' ? 'Testnet' : 'Custom network'}
          </div>

          <button
            className="secondary-button theme-toggle"
            onClick={() =>
              setTheme((current) => {
                const nextTheme = current === 'dark' ? 'light' : 'dark'
                applyTheme(nextTheme)
                return nextTheme
              })}
            type="button"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            <ThemeIcon theme={theme} />
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>

          {wallet ? (
            <button
              className="secondary-button wallet-disconnect-button"
              onClick={handleDisconnectWallet}
              type="button"
              aria-label={`Disconnect wallet ${wallet.address}`}
            >
              <span className="wallet-disconnect-copy">
                <span className="wallet-disconnect-status">Wallet connected</span>
                <span className="wallet-disconnect-address">{shortenAddress(wallet.address)}</span>
              </span>
              <span className="disconnect-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path
                    d="M14 7V5a2 2 0 0 0-2-2H5A2 2 0 0 0 3 5v14a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M10 12h11m-4-4 4 4-4 4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="wallet-disconnect-label">Disconnect</span>
            </button>
          ) : (
            <button className="primary-button" onClick={handleConnectWallet} disabled={isWalletBusy}>
              {isWalletBusy ? 'Opening wallets...' : 'Connect wallet'}
            </button>
          )}
        </div>
      </header>

      {notice && (
        <section className={`notice ${notice.type}`}>
          <strong>{notice.title}</strong>
          <span>{notice.message}</span>
        </section>
      )}

      {bootError && (
        <section className="notice error">
          <strong>{bootError.title}</strong>
          <span>{bootError.message}</span>
        </section>
      )}

      <main className="dashboard">
        <section className="hero-grid">
          <article className="panel hero-card">
            <div className="hero-card-copy">
              <p className="section-label">Wallet options available</p>
              <h2>One poll contract, many wallet entry points</h2>
              <p>
                The app is wired for {SUPPORTED_WALLET_NAMES.length}+ Stellar wallets through
                StellarWalletsKit. Use any supported wallet to create polls, cast votes, and
                close polls directly from the frontend.
              </p>
            </div>

            <div className="wallet-grid">
              {SUPPORTED_WALLET_NAMES.map((walletName) => (
                <div key={walletName} className="wallet-chip">
                  {walletName}
                </div>
              ))}
            </div>
          </article>

          <article className="panel status-card">
            <div className="status-card-top">
              <p className="section-label">Transaction status</p>
              <span className={`phase-badge ${transaction.phase}`}>{transaction.phase}</span>
            </div>
            <p className="status-message">{getTransactionCopy(transaction)}</p>

            {transaction.hash && (
              <a
                className="inline-link"
                href={getExplorerLink('tx', transaction.hash)}
                target="_blank"
                rel="noreferrer"
              >
                View transaction on Stellar Expert
              </a>
            )}

            <dl className="status-list">
              <div>
                <dt>RPC</dt>
                <dd>{RPC_URL}</dd>
              </div>
              <div>
                <dt>Contract</dt>
                <dd>{CONTRACT_ID || 'Add VITE_STELLAR_CONTRACT_ID'}</dd>
              </div>
              <div>
                <dt>Last sync</dt>
                <dd>{formatDateTime(lastSyncedAt)}</dd>
              </div>
            </dl>
          </article>
        </section>

        <section className="stats-grid">
          <StatCard label="Total polls" value={stats.totalPolls} />
          <StatCard label="Active polls" value={stats.activePolls} />
          <StatCard label="Total votes" value={stats.totalVotes} />
        </section>

        <section className="workspace-grid">
          <article className="panel compose-panel">
            <div className="panel-head">
              <div>
                <p className="section-label">Write to contract</p>
                <h3>Create a poll</h3>
              </div>
              <span className="panel-meta">{wallet ? shortenAddress(wallet.address) : 'Wallet required'}</span>
            </div>

            <label className="field">
              <span>Question</span>
              <textarea
                value={form.question}
                onChange={(event) => setForm((current) => ({ ...current, question: event.target.value }))}
                placeholder="What should the community vote on?"
                rows={4}
              />
            </label>

            <div className="field">
              <span>Options</span>
              <div className="option-stack">
                {form.options.map((option, index) => (
                  <div key={`${index}-${form.options.length}`} className="option-row">
                    <input
                      value={option}
                      onChange={(event) => updateOption(index, event.target.value)}
                      placeholder={`Option ${index + 1}`}
                    />
                    <button className="icon-button" onClick={() => removeOption(index)} type="button">
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <button className="ghost-button" onClick={addOption} type="button">
                Add option
              </button>
            </div>

            <div className="field">
              <span>Duration</span>
              <div className="duration-row">
                {DURATION_PRESETS.map((minutes) => (
                  <button
                    key={minutes}
                    className={minutes === form.duration ? 'duration-pill active' : 'duration-pill'}
                    onClick={() => setForm((current) => ({ ...current, duration: minutes }))}
                    type="button"
                  >
                    {minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`}
                  </button>
                ))}
              </div>
            </div>

            {formError && <p className="form-error">{formError}</p>}

            <div className="panel-actions">
              <button className="secondary-button" onClick={() => setForm(EMPTY_FORM)} type="button">
                Reset
              </button>
              <button
                className="primary-button"
                onClick={() =>
                  createPollAction.action === 'connect'
                    ? handleConnectWallet()
                    : handleCreatePoll()
                }
                disabled={createPollAction.disabled}
                type="button"
              >
                {createPollAction.label}
              </button>
            </div>
          </article>

          <article className="panel sync-panel">
            <div className="panel-head">
              <div>
                <p className="section-label">Read from contract</p>
                <h3>Live sync overview</h3>
              </div>
              <button className="secondary-button" onClick={() => refreshPollState()} type="button">
                {isRefreshing || isBooting ? 'Refreshing...' : 'Refresh now'}
              </button>
            </div>

            <ul className="sync-list">
              <li>Source of truth: deployed Soroban contract state</li>
              <li>Real-time updates: contract event polling every 5 seconds</li>
              <li>Error handling: wallet missing, wallet rejected, insufficient balance</li>
              <li>Wallet mode: {wallet ? `${wallet.walletName} connected` : 'read-only browsing'}</li>
            </ul>

            {CONTRACT_ID && (
              <a
                className="inline-link"
                href={getExplorerLink('contract', CONTRACT_ID)}
                target="_blank"
                rel="noreferrer"
              >
                Open contract on Stellar Expert
              </a>
            )}

            <div className="event-feed">
              <div className="event-feed-head">
                <p className="section-label">Recent contract events</p>
                <span className="panel-meta">{recentEvents.length} tracked</span>
              </div>

              {recentEvents.length === 0 ? (
                <p className="event-empty">
                  Waiting for new create, vote, close, or delete events from testnet.
                </p>
              ) : (
                <div className="event-list">
                  {recentEvents.map((event) => (
                    <article key={event.id} className="event-card">
                      <div className="event-card-head">
                        <div>
                          <strong>{event.title}</strong>
                          <p>{event.summary}</p>
                        </div>
                        <span
                          className={`state-pill ${
                            event.action === 'close' || event.action === 'delete'
                              ? 'closed'
                              : 'active'
                          }`}
                        >
                          {event.action}
                        </span>
                      </div>

                      <div className="event-meta">
                        <span>Poll #{event.pollId}</span>
                        <span>Ledger {event.ledger}</span>
                        <span>{formatEventTime(event.ledgerClosedAt)}</span>
                      </div>

                      <a
                        className="inline-link"
                        href={getExplorerLink('tx', event.txHash)}
                        rel="noreferrer"
                        target="_blank"
                      >
                        View event transaction
                      </a>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </article>
        </section>

        <section className="panel poll-panel">
          <div className="panel-head controls-head">
            <div>
              <p className="section-label">Poll feed</p>
              <h3>Browse synced contract data</h3>
            </div>

            <div className="control-strip">
              <input
                className="search-input"
                placeholder="Search polls or options"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />

              <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </select>

              <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                <option value="ending-soon">Ending soon</option>
                <option value="most-votes">Most votes</option>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
              </select>

              <div className="view-toggle" role="group" aria-label="Poll layout">
                <button
                  className={pollView === 'grid' ? 'view-toggle-button active' : 'view-toggle-button'}
                  onClick={() => setPollView('grid')}
                  type="button"
                  aria-pressed={pollView === 'grid'}
                >
                  <ViewIcon view="grid" />
                  Grid
                </button>
                <button
                  className={pollView === 'list' ? 'view-toggle-button active' : 'view-toggle-button'}
                  onClick={() => setPollView('list')}
                  type="button"
                  aria-pressed={pollView === 'list'}
                >
                  <ViewIcon view="list" />
                  List
                </button>
              </div>
            </div>
          </div>

          {isBooting ? (
            <div className="empty-state">
              <h4>Loading contract state...</h4>
              <p>The app is preparing a read account and fetching polls from testnet.</p>
            </div>
          ) : visiblePolls.length === 0 ? (
            <div className="empty-state">
              <h4>No polls found</h4>
              <p>Create the first on-chain poll to start testing real-time voting.</p>
            </div>
          ) : (
            <div className={pollView === 'list' ? 'poll-grid list' : 'poll-grid'}>
              {visiblePolls.map((poll) => {
                const totalVotes = poll.votes.reduce((sum, vote) => sum + vote, 0)
                const state = getPollState(poll)

                return (
                  <article
                    key={poll.id}
                    className={selectedPoll?.id === poll.id ? 'poll-card selected' : 'poll-card'}
                  >
                    <div className="poll-card-head">
                      <span className={`state-pill ${state}`}>{state}</span>
                      <span className="time-pill">{formatTimeLeft(poll.expiresAt)}</span>
                    </div>

                    <h4>{poll.question}</h4>
                    <p className="poll-meta">
                      Poll #{poll.id} by {shortenAddress(poll.creator)}
                    </p>
                    <p className="poll-meta">{totalVotes} votes recorded on-chain</p>

                    <div className="option-preview">
                      {poll.options.slice(0, 3).map((option) => (
                        <span key={option}>{option}</span>
                      ))}
                    </div>

                    <div className="card-actions">
                      <button className="secondary-button" onClick={() => openPollDetails(poll.id)} type="button">
                        View details
                      </button>
                      <div className="detail-actions">
                        <button
                          className="ghost-button"
                          onClick={() => {
                            const shareLink = `${window.location.origin}${window.location.pathname}${window.location.search}#poll-${poll.id}`
                            navigator.clipboard
                              .writeText(shareLink)
                              .then(() => {
                                showNotice('info', 'Share link copied', `Link copied for poll #${poll.id}.`)
                              })
                              .catch(() => {
                                showNotice(
                                  'error',
                                  'Copy failed',
                                  'Clipboard access was blocked, so the share link could not be copied.',
                                )
                              })
                          }}
                          type="button"
                        >
                          Copy link
                        </button>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        {selectedPoll && (
          <section className="panel detail-panel" id={`poll-${selectedPoll.id}`}>
            <div className="panel-head">
              <div>
                <p className="section-label">Selected poll</p>
                <h3>{selectedPoll.question}</h3>
              </div>
              <div className="detail-head-actions">
                {isPollOwner(selectedPoll, wallet?.address) && selectedPollState === 'active' && (
                  <button
                    className="secondary-button"
                    onClick={() => handleClosePoll(selectedPoll.id)}
                    type="button"
                  >
                    Close poll
                  </button>
                )}
                <button className="ghost-button" onClick={dismissSelectedPoll} type="button">
                  Dismiss
                </button>
              </div>
            </div>

            <p className="detail-meta">
              Created by {shortenAddress(selectedPoll.creator)} on{' '}
              {new Date(selectedPoll.createdAt).toLocaleString()}
            </p>
            <p className="detail-meta">Expires {new Date(selectedPoll.expiresAt).toLocaleString()}</p>

            <div className="detail-summary">
              <span className={`state-pill ${selectedPollState}`}>{selectedPollState}</span>
              <span className="panel-meta">{selectedPollTotalVotes} total votes</span>
              <span className="time-pill">{formatTimeLeft(selectedPoll.expiresAt)}</span>
            </div>

            <div className="results-stack">
              {selectedPoll.options.map((option, index) => {
                const votes = selectedPoll.votes[index] || 0
                const percentage =
                  selectedPollTotalVotes === 0
                    ? 0
                    : Math.round((votes / selectedPollTotalVotes) * 100)
                const voteAction = getVoteActionState({
                  poll: selectedPoll,
                  walletAddress: wallet?.address,
                  hasVoted: Boolean(voteLookup[selectedPoll.id]),
                  transactionPhase: transaction.phase,
                  isWalletBusy,
                })

                return (
                  <div key={`${selectedPoll.id}-${option}`} className="result-row">
                    <div className="result-copy">
                      <span>{option}</span>
                      <span>
                        {votes} votes • {percentage}%
                      </span>
                    </div>

                    <div className="result-bar-shell">
                      <div className="result-bar-fill" style={{ width: `${percentage}%` }} />
                    </div>

                    <button
                      className="primary-button small"
                      onClick={() =>
                        voteAction.action === 'connect'
                          ? handleConnectWallet()
                          : handleVote(selectedPoll.id, index)
                      }
                      disabled={voteAction.disabled}
                      type="button"
                    >
                      {voteAction.label}
                    </button>
                  </div>
                )
              })}
            </div>

            <div className="detail-footer">
              <div>
                <p className="detail-note">
                  Votes, closures, and deletions are written on-chain, then reloaded through the
                  event sync loop.
                </p>
                <p className="detail-note">
                  Connected wallet: {wallet ? wallet.walletName : 'No wallet connected'}
                </p>
              </div>

              {isPollOwner(selectedPoll, wallet?.address) && (
                <button
                  className="secondary-button danger"
                  onClick={() => handleMenuDeletePoll(selectedPoll.id)}
                  type="button"
                >
                  Delete poll
                </button>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <article className="panel stat-card">
      <p className="section-label">{label}</p>
      <strong>{value}</strong>
    </article>
  )
}

export default App
