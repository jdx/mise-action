import assert from 'node:assert/strict'
import test from 'node:test'
import { parseManagedPaths, selectPathAdditions } from '../src/managed-paths.ts'

test('reads one entry per line, tolerating CRLF and blank lines', () => {
  assert.deepEqual(
    parseManagedPaths(0, '/mise/installs/node/bin\r\n\r\n/home/me/.cargo/bin\n'),
    ['/mise/installs/node/bin', '/home/me/.cargo/bin']
  )
})

test('an empty list is a valid answer', () => {
  assert.deepEqual(parseManagedPaths(0, ''), [])
})

test('a non-zero exit means the mise version has no --paths', () => {
  assert.equal(parseManagedPaths(2, 'error: unexpected argument'), undefined)
})

test('exports a directory the PATH already had, ahead of the shims', () => {
  // mise moved ~/.cargo/bin forward; deriving it from the PATH would skip it.
  const managed = parseManagedPaths(
    0,
    '/mise/installs/java/bin\n/home/runner/.cargo/bin\n'
  )
  const derive = () => assert.fail('must not derive when mise reported entries')
  assert.deepEqual(selectPathAdditions(managed, derive), [
    '/mise/installs/java/bin',
    '/home/runner/.cargo/bin'
  ])
})

test('an empty reported list exports nothing and does not derive', () => {
  const derive = () => assert.fail('must not derive when mise reported entries')
  assert.deepEqual(selectPathAdditions([], derive), [])
})

test('derives the entries when mise did not report any', () => {
  const managed = parseManagedPaths(2, '')
  assert.deepEqual(selectPathAdditions(managed, () => ['/derived/bin']), [
    '/derived/bin'
  ])
})
