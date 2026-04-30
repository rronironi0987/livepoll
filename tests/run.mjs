import assert from 'node:assert/strict'
import { getPollState, mergeRecentEvents, parsePollHash } from '../src/lib/pollLogic.js'
import { readCachedPolls, removeCachedPoll, writeCachedPolls } from '../src/lib/pollCache.js'

function createMemoryStorage() {
  const store = new Map()

  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
  }
}

const tests = []

function test(name, fn) {
  tests.push({ name, fn })
}

test('parsePollHash extracts poll id', () => {
  assert.equal(parsePollHash('#poll-1'), 1)
  assert.equal(parsePollHash('#poll-42'), 42)
  assert.equal(parsePollHash('#poll-0007'), 7)
})

test('parsePollHash rejects invalid hashes', () => {
  assert.equal(parsePollHash(''), null)
  assert.equal(parsePollHash('#poll-'), null)
  assert.equal(parsePollHash('#poll-abc'), null)
  assert.equal(parsePollHash('#something-12'), null)
})

test('mergeRecentEvents de-dupes and limits results', () => {
  const current = [
    { id: 'b', ledger: 2 },
    { id: 'a', ledger: 1 },
  ]
  const next = [
    { id: 'c', ledger: 3 },
    { id: 'b', ledger: 2 },
  ]

  const merged = mergeRecentEvents(current, next, 3)
  assert.deepEqual(
    merged.map((event) => event.id),
    ['c', 'b', 'a'],
  )
})

test('getPollState returns active/closed using provided time', () => {
  const poll = { expiresAt: 2000, active: true }
  assert.equal(getPollState(poll, 1500), 'active')
  assert.equal(getPollState(poll, 2500), 'closed')
  assert.equal(getPollState({ ...poll, active: false }, 1500), 'closed')
})

test('poll cache round-trips polls and supports removal', () => {
  const storage = createMemoryStorage()
  writeCachedPolls([{ id: 1 }, { id: 2 }, { id: 3 }], storage)

  assert.deepEqual(readCachedPolls(storage).map((poll) => poll.id), [1, 2, 3])

  removeCachedPoll(2, storage)
  assert.deepEqual(readCachedPolls(storage).map((poll) => poll.id), [1, 3])
})

test('poll cache handles invalid json and legacy arrays', () => {
  const storage = createMemoryStorage()
  storage.setItem('livepoll_cached_polls', '{ not json }')
  assert.deepEqual(readCachedPolls(storage), [])

  storage.setItem('livepoll_cached_polls', JSON.stringify([{ id: 9 }]))
  assert.deepEqual(readCachedPolls(storage), [{ id: 9 }])
})

let failed = 0

for (const { name, fn } of tests) {
  try {
    // Support async tests if needed later.
    await fn()
    process.stdout.write(`PASS ${name}\n`)
  } catch (error) {
    failed += 1
    process.stdout.write(`FAIL ${name}\n`)
    process.stdout.write(`${error?.stack || error}\n`)
  }
}

process.stdout.write(`\n${tests.length - failed} passing, ${failed} failing\n`)
process.exitCode = failed ? 1 : 0

