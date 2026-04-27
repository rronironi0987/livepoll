import {
  startTransition,
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

const EMPTY_FORM = {
  question: '',
  options: ['', ''],
  duration: 60,
}

const DURATION_PRESETS = [5, 15, 30, 60, 180, 1440]

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

function getPollState(poll) {
  return Date.now() > poll.expiresAt || !poll.active ? 'closed' : 'active'
}

function parsePollHash(hashValue) {
  const match = /^#poll-(\d+)$/.exec(hashValue || '')
  return match ? Number(match[1]) : null
}

function mergeRecentEvents(currentEvents, nextEvents) {
  const merged = [...nextEvents, ...currentEvents]
  const uniqueEvents = merged.filter(
    (event, index) => merged.findIndex((candidate) => candidate.id === event.id) === index,
  )

  return uniqueEvents.slice(0, 8)
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
  const [wallet, setWallet] = useState(null)
  const [polls, setPolls] = useState([])
  const [voteLookup, setVoteLookup] = useState({})
  const [selectedPollId, setSelectedPollId] = useState(null)
  const [filter, setFilter] = useState('all')
  const [sortBy, setSortBy] = useState('ending-soon')
  const [searchQuery, setSearchQuery] = useState('')
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

  const selectedPoll = useMemo(
    () => polls.find((poll) => poll.id === selectedPollId) || null,
    [polls, selectedPollId],
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
      const readAddress = wallet?.address || (await ensureReadAccount())
      const nextPolls = await fetchPolls(readAddress)
      const nextVotes = await fetchVoteStatuses(nextPolls, wallet?.address, readAddress)

      startTransition(() => {
        setPolls(nextPolls)
        setVoteLookup(nextVotes)
      })

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
        creator: wallet.address,
        question,
        options,
        duration_minutes: form.duration,
      },
      'Poll created',
      'Your poll was deployed to the contract and will appear after the next sync.',
    )

    if (created) {
      setForm(EMPTY_FORM)
    }
  }

  async function handleVote(pollId, optionIndex) {
    await runContractWrite(
      'vote',
      {
        voter: wallet.address,
        poll_id: pollId,
        option_index: optionIndex,
      },
      'Vote submitted',
      'Your vote was written to the contract and the UI is syncing the latest totals.',
    )
  }

  async function handleClosePoll(pollId) {
    await runContractWrite(
      'close_poll',
      {
        poll_id: pollId,
        caller: wallet.address,
      },
      'Poll closed',
      'The contract marked this poll as inactive.',
    )
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

          {wallet ? (
            <button className="secondary-button" onClick={handleDisconnectWallet}>
              {shortenAddress(wallet.address)}
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
              <button className="primary-button" onClick={handleCreatePoll} type="button">
                Create on-chain poll
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
                  Waiting for new create, vote, or close events from testnet.
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
                        <span className={`state-pill ${event.action === 'close' ? 'closed' : 'active'}`}>
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
            <div className="poll-grid">
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
              <button
                className="ghost-button"
                onClick={() => {
                  setSelectedPollId(null)
                  clearPollHash()
                }}
                type="button"
              >
                Close
              </button>
            </div>

            <p className="detail-meta">
              Created by {shortenAddress(selectedPoll.creator)} on{' '}
              {new Date(selectedPoll.createdAt).toLocaleString()}
            </p>
            <p className="detail-meta">Expires {new Date(selectedPoll.expiresAt).toLocaleString()}</p>

            <div className="results-stack">
              {selectedPoll.options.map((option, index) => {
                const votes = selectedPoll.votes[index] || 0
                const totalVotes = selectedPoll.votes.reduce((sum, vote) => sum + vote, 0)
                const percentage = totalVotes === 0 ? 0 : Math.round((votes / totalVotes) * 100)

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
                      onClick={() => handleVote(selectedPoll.id, index)}
                      disabled={
                        !wallet ||
                        getPollState(selectedPoll) === 'closed' ||
                        voteLookup[selectedPoll.id]
                      }
                      type="button"
                    >
                      {voteLookup[selectedPoll.id] ? 'Already voted' : 'Vote'}
                    </button>
                  </div>
                )
              })}
            </div>

            <div className="detail-footer">
              <div>
                <p className="detail-note">
                  Votes and poll closures are written on-chain, then reloaded through the event
                  sync loop.
                </p>
                <p className="detail-note">
                  Connected wallet: {wallet ? wallet.walletName : 'No wallet connected'}
                </p>
              </div>

              {wallet?.address === selectedPoll.creator && getPollState(selectedPoll) === 'active' && (
                <button className="secondary-button" onClick={() => handleClosePoll(selectedPoll.id)} type="button">
                  Close poll on-chain
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
