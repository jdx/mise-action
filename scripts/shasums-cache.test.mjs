import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readCachedShasums, writeCachedShasums } from '../src/shasums-cache.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shasums-cache-'))
const accept = () => {}
const reject = () => {
  throw new Error('bad signature')
}

test('returns checksums written by an earlier run once they verify', () => {
  const dir = tmp()
  writeCachedShasums(dir, '2026.1.0', 'abc  mise-linux-x64', 'sig')
  let seen
  const got = readCachedShasums(dir, '2026.1.0', (shasums, minisig) => {
    seen = [shasums, minisig]
  })
  assert.equal(got, 'abc  mise-linux-x64')
  assert.deepEqual(seen, ['abc  mise-linux-x64', 'sig'])
})

test('ignores cached checksums whose signature no longer verifies', () => {
  const dir = tmp()
  writeCachedShasums(dir, '2026.1.0', 'tampered', 'sig')
  assert.equal(readCachedShasums(dir, '2026.1.0', reject), undefined)
})

test('has nothing for a version that was never saved', () => {
  const dir = tmp()
  writeCachedShasums(dir, '2026.1.0', 'abc', 'sig')
  assert.equal(readCachedShasums(dir, '2026.1.1', accept), undefined)
})

test('has nothing when the directory does not exist', () => {
  assert.equal(
    readCachedShasums(path.join(tmp(), 'missing'), '2026.1.0', accept),
    undefined
  )
})
