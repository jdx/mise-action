import assert from 'node:assert/strict'
import test from 'node:test'
import { downloadFromFirstAvailable, miseReleaseUrls } from '../src/mise-download.ts'

const cdn = 'https://mise.jdx.dev/v2026.10.10/mise-v2026.10.10-linux-x64.tar.zst'
const github = 'https://github.com/jdx/mise/releases/download/v2026.10.10/mise-v2026.10.10-linux-x64.tar.zst'

test('tries the mise.jdx.dev release mirror before the GitHub release', () => {
  assert.deepEqual(miseReleaseUrls('2026.10.10', 'mise-v2026.10.10-linux-x64.tar.zst', false), [cdn, github])
})

test('fetch_from_github skips the mirror', () => {
  assert.deepEqual(miseReleaseUrls('2026.10.10', 'mise-v2026.10.10-linux-x64.tar.zst', true), [github])
})

test('uses the first source without falling back', async () => {
  const calls = []
  const fallbacks = []
  const result = await downloadFromFirstAvailable(
    [cdn, github],
    async (url, retry) => {
      calls.push([url, retry])
      return 'cdn body'
    },
    (...args) => fallbacks.push(args)
  )
  assert.equal(result, 'cdn body')
  assert.deepEqual(calls, [[cdn, false]])
  assert.deepEqual(fallbacks, [])
})

test('falls back to GitHub, with retries, when the mirror fails', async () => {
  const calls = []
  const fallbacks = []
  const result = await downloadFromFirstAvailable(
    [cdn, github],
    async (url, retry) => {
      calls.push([url, retry])
      if (url === cdn) throw new Error('curl: (22) The requested URL returned error: 404')
      return 'github body'
    },
    (failed, next, err) => fallbacks.push([failed, next, err.message])
  )
  assert.equal(result, 'github body')
  assert.deepEqual(calls, [
    [cdn, false],
    [github, true]
  ])
  assert.deepEqual(fallbacks, [[cdn, github, 'curl: (22) The requested URL returned error: 404']])
})

test('a single source is downloaded with retries and its error is not swallowed', async () => {
  const calls = []
  await assert.rejects(
    downloadFromFirstAvailable(
      [github],
      async (url, retry) => {
        calls.push([url, retry])
        throw new Error('offline')
      },
      () => assert.fail('no fallback with a single source')
    ),
    /offline/
  )
  assert.deepEqual(calls, [[github, true]])
})

test('fails when every source fails', async () => {
  await assert.rejects(
    downloadFromFirstAvailable(
      [cdn, github],
      async url => {
        throw new Error(`failed ${url}`)
      },
      () => {}
    ),
    new RegExp(`failed ${github}`)
  )
})
