import assert from 'node:assert/strict'
import test from 'node:test'
import {
  backoffDelayMs,
  downloadError,
  describeUrl,
  hostOf,
  sanitizeDetail,
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
    stderr: ''
  })
  assert.match(err.message, /HTTP 503 from github\.com/)
  assert.ok(!(err instanceof NonRetryableError))
  assert.match(
    downloadError({ url: 'https://h/x', stderr: 'curl: (28) timed out' })
      .message,
    /no HTTP response from h.*timed out/
  )
  assert.ok(
    downloadError({ url: 'https://h/x', status: 404, stderr: '' }) instanceof
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
        throw downloadError({ url: 'https://h/x', status: 503, stderr: '' })
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
        throw downloadError({ url: 'https://h/x', status: 404, stderr: '' })
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
        throw downloadError({ url: 'https://h/x', status: 500, stderr: '' })
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
    stderr: 'curl: (18) transfer closed'
  })
  assert.ok(!(err instanceof NonRetryableError))
  assert.match(err.message, /transfer interrupted after HTTP 200 from h/)
})

test('diagnostics drop signed URLs and response headers', () => {
  const wgetStderr = [
    '  HTTP/1.1 302 Found',
    '  Location: https://objects.example.com/x?X-Amz-Signature=secret',
    '  Set-Cookie: session=secret',
    'https://objects.example.com/x?X-Amz-Signature=secret: Connection reset'
  ].join('\n')
  assert.equal(
    sanitizeDetail(wgetStderr),
    'objects.example.com: Connection reset'
  )
  assert.equal(
    sanitizeDetail('curl: (22) The requested URL returned error: 503'),
    'curl: (22) The requested URL returned error: 503'
  )
  const err = downloadError({
    url: 'https://github.com/jdx/mise/releases/download/v1/x.tar.zst?token=secret',
    status: 503,
    stderr: wgetStderr
  })
  assert.ok(!/secret|Set-Cookie|Signature/.test(err.message), err.message)
  assert.match(err.message, /github\.com\/…\/x\.tar\.zst \(HTTP 503 from github\.com\)/)
})

test('a local write failure after HTTP 200 is not retried', () => {
  const err = downloadError({
    url: 'https://h/x',
    status: 200,
    stderr: 'curl: (23) Failure writing output to destination',
    localError: true
  })
  assert.ok(err instanceof NonRetryableError)
})

test('userinfo never reaches diagnostics', () => {
  assert.equal(
    sanitizeDetail('failed: https://user:pw@cdn.example:8443/x?a=1'),
    'failed: cdn.example:8443'
  )
  assert.equal(hostOf('https://user:pw@cdn.example/x'), 'cdn.example')
  assert.equal(hostOf('not a url'), undefined)
})

test('reports the host that sent the failing response after a redirect', () => {
  const err = downloadError({
    url: 'https://github.com/jdx/mise/releases/download/v1/x.tar.zst',
    status: 503,
    host: 'objects.githubusercontent.com',
    stderr: ''
  })
  assert.match(err.message, /HTTP 503 from objects\.githubusercontent\.com/)
  assert.match(err.message, /Could not download github\.com\/…\/x\.tar\.zst/)
})
