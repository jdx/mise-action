import process from 'node:process'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  captureWarnings,
  detectThrottle,
  parseDuration,
  retryOnThrottle,
  withThrottleRetry
} from '../src/cache-retry.ts'

const limited = [
  "You've hit a rate limit, your rate limit will reset in 7 seconds",
  'Failed to save: Rate limited: Failed request: (429) Too Many Requests'
]

test('parses durations', () => {
  assert.equal(parseDuration('0s'), 0)
  assert.equal(parseDuration(''), 0)
  assert.equal(parseDuration('60s'), 60000)
  assert.equal(parseDuration('2m'), 120000)
  assert.equal(parseDuration('30'), 30000)
  assert.equal(parseDuration('1.5s'), 1500)
  assert.throws(() => parseDuration('soon', 'x'), /x must be a duration/)
})

test('detects throttling and Retry-After', () => {
  assert.deepEqual(detectThrottle(limited), { retryAfterMs: 7000 })
  assert.deepEqual(
    detectThrottle(['Failed to restore: Rate limited: Failed request: (429)']),
    {}
  )
})

test('detects a throttled save reservation', () => {
  assert.deepEqual(
    detectThrottle([
      "You've hit a rate limit, your rate limit will reset in 3 seconds",
      'Failed to reserve cache: RateLimitError: Rate limited: Failed request: (429) Too Many Requests'
    ]),
    { retryAfterMs: 3000 }
  )
  // no Retry-After header: only the debug line is left
  assert.deepEqual(
    detectThrottle([
      'Failed to reserve cache: RateLimitError: Rate limited: Failed request: (429) Too Many Requests'
    ]),
    {}
  )
})

test('does not treat misses or reservation conflicts as throttling', () => {
  assert.equal(detectThrottle([]), undefined)
  assert.equal(
    detectThrottle(['Failed to reserve cache: Error: Response was not ok']),
    undefined
  )
  assert.equal(
    detectThrottle(['Failed to save: Unable to reserve cache with key k']),
    undefined
  )
  assert.equal(
    detectThrottle(['Failed to restore: Failed request: (500) boom']),
    undefined
  )
})

function run(throttles, budgetMs, rand = 0.5) {
  const sleeps = []
  let calls = 0
  return retryOnThrottle(
    async () => {
      const t = throttles[calls++]
      return { value: calls, throttle: t }
    },
    { budgetMs, sleep: async ms => void sleeps.push(ms), random: () => rand }
  ).then(value => ({ value, sleeps, calls }))
}

test('retries until success, delay = Retry-After + jitter', async () => {
  const r = await run([{ retryAfterMs: 5000 }, undefined], 60000, 0.5)
  assert.deepEqual(r.sleeps, [6000])
  assert.equal(r.calls, 2)
})

test('defaults to 1s when Retry-After is absent', async () => {
  const r = await run([{}, undefined], 60000, 0)
  assert.deepEqual(r.sleeps, [1000])
})

test('jitter stays within [0, 2s]', async () => {
  const r = await run([{ retryAfterMs: 0 }, undefined], 60000, 0.999999)
  assert.ok(r.sleeps[0] <= 2000)
})

test('zero budget never retries', async () => {
  const r = await run([{ retryAfterMs: 1000 }, undefined], 0)
  assert.deepEqual(r.sleeps, [])
  assert.equal(r.calls, 1)
  assert.equal(r.value, 1)
})

test('stops when the next delay exceeds the remaining budget', async () => {
  // each delay is 5s + 1s jitter = 6s; 15s fits two, not a third
  const t = { retryAfterMs: 5000 }
  const r = await run([t, t, t, t, undefined], 15000, 0.5)
  assert.deepEqual(r.sleeps, [6000, 6000])
  assert.equal(r.calls, 3)
  assert.equal(r.value, 3)
})

test('a single delay larger than the budget does not retry', async () => {
  const r = await run([{ retryAfterMs: 90000 }, undefined], 60000)
  assert.equal(r.calls, 1)
  assert.equal(r.value, 1)
})

test('captureWarnings collects warning commands and passes output through', async () => {
  const { value, warnings } = await captureWarnings(async () => {
    process.stdout.write('::warning::a%0Ab\n')
    process.stdout.write('::debug::dbg\n::notice::skip\n::warning')
    process.stdout.write('::split\n')
    return 42
  })
  assert.equal(value, 42)
  assert.deepEqual(warnings, ['a\nb', 'dbg', 'split'])
})

test('withThrottleRetry retries a swallowed 429', async () => {
  let calls = 0
  const out = await withThrottleRetry(
    async () => {
      calls++
      if (calls === 1) {
        process.stdout.write(`::warning::${limited[0]}\n`)
        process.stdout.write(`::warning::${limited[1]}\n`)
        return -1
      }
      return 123
    },
    { budgetMs: 60000, sleep: async () => {}, random: () => 0 }
  )
  assert.equal(out, 123)
  assert.equal(calls, 2)
})

test('withThrottleRetry with no budget calls once', async () => {
  let calls = 0
  await withThrottleRetry(async () => ++calls, { budgetMs: 0 })
  assert.equal(calls, 1)
})
