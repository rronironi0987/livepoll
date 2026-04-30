export const POLL_CACHE_STORAGE_KEY = 'livepoll_cached_polls'

function getDefaultStorage() {
  const storage = globalThis?.localStorage
  if (!storage) {
    return null
  }

  try {
    const testKey = '__livepoll_storage_test__'
    storage.setItem(testKey, '1')
    storage.removeItem(testKey)
    return storage
  } catch {
    return null
  }
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function readCachedPolls(storage = getDefaultStorage()) {
  if (!storage) {
    return []
  }

  const cached = storage.getItem(POLL_CACHE_STORAGE_KEY)
  if (!cached) {
    return []
  }

  const parsed = safeJsonParse(cached)
  if (Array.isArray(parsed)) {
    return parsed
  }

  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.polls)) {
    return parsed.polls
  }

  return []
}

export function writeCachedPolls(polls, storage = getDefaultStorage()) {
  if (!storage) {
    return
  }

  try {
    if (!Array.isArray(polls) || polls.length === 0) {
      storage.removeItem(POLL_CACHE_STORAGE_KEY)
      return
    }

    storage.setItem(
      POLL_CACHE_STORAGE_KEY,
      JSON.stringify({ polls, cachedAt: Date.now() }),
    )
  } catch {
    // Cache writes are best effort only.
  }
}

export function removeCachedPoll(pollId, storage = getDefaultStorage()) {
  const remainingPolls = readCachedPolls(storage).filter((poll) => poll.id !== pollId)
  writeCachedPolls(remainingPolls, storage)
}

