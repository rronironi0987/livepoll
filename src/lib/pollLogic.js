export function getPollState(poll, now = Date.now()) {
  return now > poll.expiresAt || !poll.active ? 'closed' : 'active'
}

export function parsePollHash(hashValue) {
  const match = /^#poll-(\d+)$/.exec(hashValue || '')
  return match ? Number(match[1]) : null
}

export function mergeRecentEvents(currentEvents, nextEvents, limit = 8) {
  const merged = [...nextEvents, ...currentEvents]
  const uniqueEvents = merged.filter(
    (event, index) => merged.findIndex((candidate) => candidate.id === event.id) === index,
  )

  return uniqueEvents.slice(0, limit)
}

