import assert from 'node:assert/strict'
import { delimiter } from 'node:path'
import test from 'node:test'
import { getMisePathAdditions } from '../src/path-additions.ts'

const additions = (current, computed) =>
  getMisePathAdditions(current.join(delimiter), computed.join(delimiter))

test('returns the prefix mise added before the unchanged PATH', () => {
  assert.deepEqual(
    additions(
      ['/mise/shims', '/usr/bin', '/bin'],
      ['/mise/installs/node/bin', '/repo/bin', '/mise/shims', '/usr/bin', '/bin']
    ),
    ['/mise/installs/node/bin', '/repo/bin']
  )
})

test('returns nothing when mise leaves PATH unchanged', () => {
  assert.deepEqual(additions(['/usr/bin', '/bin'], ['/usr/bin', '/bin']), [])
})

test('keeps entries mise promotes from further down the PATH', () => {
  // rust's bin directory is ~/.cargo/bin, which GitHub's runner images already
  // have on PATH behind the shims directory the action adds.
  assert.deepEqual(
    additions(
      [
        '/mise/shims',
        '/home/runner/.local/bin',
        '/home/runner/.cargo/bin',
        '/usr/bin'
      ],
      [
        '/mise/installs/java/bin',
        '/home/runner/.cargo/bin',
        '/mise/installs/flutter/bin',
        '/mise/shims',
        '/home/runner/.local/bin',
        '/usr/bin'
      ]
    ),
    [
      '/mise/installs/java/bin',
      '/home/runner/.cargo/bin',
      '/mise/installs/flutter/bin'
    ]
  )
})

test('keeps an [env] _.path entry that was already first on PATH', () => {
  assert.deepEqual(
    additions(
      ['/mise/shims', '/repo/promoted', '/usr/bin'],
      ['/repo/promoted', '/repo/added', '/mise/shims', '/usr/bin']
    ),
    ['/repo/promoted', '/repo/added']
  )
})

test('tolerates duplicates mise removed from the inherited PATH', () => {
  assert.deepEqual(
    additions(
      ['/usr/local/bin', '/usr/bin', '/usr/local/bin', '/bin'],
      ['/mise/installs/node/bin', '/usr/local/bin', '/usr/bin', '/bin']
    ),
    ['/mise/installs/node/bin']
  )
})

test('adds every entry when PATH was empty', () => {
  assert.deepEqual(additions([], ['/mise/installs/node/bin', '/usr/bin']), [
    '/mise/installs/node/bin',
    '/usr/bin'
  ])
})
