import assert from 'node:assert/strict'
import test from 'node:test'
import {
  backoffDelayMs,
  downloadError,
  describeUrl,
  hostOf,
  redirectedHost,
  exitReason,
  failedStatus,
  isRetryableStatus,
  NonRetryableError,
  retryDownload
} from '../src/download-retry.ts'

test('retries transport errors and transient statuses only', () => {
  for (const s of [undefined, 0, 200, 302, 408, 429, 500, 502, 503, 504]) {
    assert.equal(isRetryableStatus(s), true, String(s))
  }
  for (const s of [400, 401, 403, 404, 410]) {
    assert.equal(isRetryableStatus(s), false, String(s))
  }
})

test('backoff doubles, is capped, and stays within the jittered range', () => {
  assert.equal(backoffDelayMs(0, () => 0), 1000)
  assert.equal(backoffDelayMs(0, () => 1), 2000)
  assert.equal(backoffDelayMs(1, () => 1), 4000)
  assert.equal(backoffDelayMs(2, () => 1), 8000)
  assert.equal(backoffDelayMs(4, () => 1), 30000)
  assert.equal(backoffDelayMs(10, () => 1), 30000)
})

test('failure messages name the status and host, not the query', () => {
  assert.equal(
    describeUrl('https://example.com/a/b.tar.zst?sig=secret'),
    'example.com/…/b.tar.zst'
  )
  const err = downloadError({
    url: 'https://github.com/jdx/mise/releases/download/v1/x.tar.zst',
    status: 503,
  })
  assert.match(err.message, /HTTP 503 from github\.com/)
  assert.ok(!(err instanceof NonRetryableError))
  assert.match(
    downloadError({ url: 'https://h/x', tool: 'curl', exitCode: 28 }).message,
    /no HTTP response from h.*curl exit 28 \(timed out\)/
  )
  assert.ok(
    downloadError({ url: 'https://h/x', status: 404 }) instanceof
      NonRetryableError
  )
})

test('retries a 503 then succeeds, sleeping with backoff', async () => {
  const sleeps = []
  const logs = []
  let calls = 0
  const result = await retryDownload(
    async () => {
      if (++calls < 3) {
        throw downloadError({ url: 'https://h/x', status: 503 })
      }
      return 'ok'
    },
    { sleep: async ms => sleeps.push(ms), random: () => 1, onRetry: m => logs.push(m) }
  )
  assert.equal(result, 'ok')
  assert.deepEqual(sleeps, [2000, 4000])
  assert.match(logs[0], /attempt 1\/6 failed.*HTTP 503 from h/)
})

test('a permanent error is not retried', async () => {
  let calls = 0
  await assert.rejects(
    retryDownload(
      async () => {
        calls++
        throw downloadError({ url: 'https://h/x', status: 404 })
      },
      { sleep: async () => {} }
    ),
    /HTTP 404/
  )
  assert.equal(calls, 1)
})

test('gives up after the configured retries', async () => {
  let calls = 0
  await assert.rejects(
    retryDownload(
      async () => {
        calls++
        throw downloadError({ url: 'https://h/x', status: 500 })
      },
      { retries: 2, sleep: async () => {} }
    ),
    /HTTP 500/
  )
  assert.equal(calls, 3)
})

test('an interrupted 200 transfer is retryable', () => {
  const err = downloadError({
    url: 'https://h/x',
    status: 200,
    tool: 'curl',
    exitCode: 18
  })
  assert.ok(!(err instanceof NonRetryableError))
  assert.match(err.message, /transfer interrupted after HTTP 200 from h/)
})

test('diagnostics name an allowlisted reason, never the tool output', () => {
  assert.equal(exitReason('curl', 6), 'curl exit 6 (could not resolve host)')
  assert.equal(exitReason('wget', 4), 'wget exit 4 (network failure)')
  assert.equal(exitReason('curl', 99), 'curl exit 99')
  const err = downloadError({
    url: 'https://github.com/jdx/mise/releases/download/v1/x.tar.zst?token=secret',
    status: 503,
    tool: 'wget',
    exitCode: 8
  })
  assert.ok(!/secret|token/.test(err.message), err.message)
  assert.match(
    err.message,
    /github\.com\/…\/x\.tar\.zst \(HTTP 503 from github\.com\): wget exit 8/
  )
})

test('a local write failure after HTTP 200 is not retried', () => {
  const err = downloadError({
    url: 'https://h/x',
    status: 200,
    tool: 'curl',
    exitCode: 23,
    localError: true
  })
  assert.ok(err instanceof NonRetryableError)
})

test('hostOf never returns userinfo', () => {
  assert.equal(hostOf('https://user:pw@cdn.example/x'), 'cdn.example')
  assert.equal(hostOf('not a url'), undefined)
})

test('reports the host that sent the failing response after a redirect', () => {
  const err = downloadError({
    url: 'https://github.com/jdx/mise/releases/download/v1/x.tar.zst',
    status: 503,
    host: 'objects.githubusercontent.com',
  })
  assert.match(err.message, /HTTP 503 from objects\.githubusercontent\.com/)
  assert.match(err.message, /Could not download github\.com\/…\/x\.tar\.zst/)
})

test('a failed redirect target is reported without the redirect status', async () => {
  // The caller drops the 3xx status when the transfer failed, so the message
  // names the target host as silent rather than as having sent that status.
  const err = downloadError({
    url: 'https://github.com/a/b',
    host: 'objects.example',
    tool: 'wget',
    exitCode: 4
  })
  assert.match(err.message, /no HTTP response from objects\.example/)
  assert.ok(!/302/.test(err.message))
})

test('follows absolute and relative redirects to the responding host', () => {
  const url = 'https://github.com/a/b'
  assert.equal(redirectedHost(url, []), undefined)
  assert.equal(
    redirectedHost(url, ['https://cdn.example/a']),
    'cdn.example'
  )
  assert.equal(
    redirectedHost(url, ['https://cdn.example/a', '/b?sig=1']),
    'cdn.example'
  )
  assert.equal(
    redirectedHost(url, ['https://cdn.example/a', 'https://other.example/c']),
    'other.example'
  )
  assert.equal(redirectedHost(url, ['http://[bad']), undefined)
})

test('a failed transfer after a redirect does not keep the redirect status', () => {
  assert.equal(failedStatus(302, 4), undefined)
  assert.equal(failedStatus(302, 0), 302)
  assert.equal(failedStatus(503, 22), 503)
  assert.equal(failedStatus(200, 18), 200)
  assert.equal(failedStatus(undefined, 7), undefined)
})
