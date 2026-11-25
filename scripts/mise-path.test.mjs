import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { misePathDirs } from '../src/mise-path.ts'

test('adds the verified bin directory last so it comes first on PATH', () => {
  assert.deepEqual(misePathDirs('/mise/bin', '/mise/shims', true), [
    '/mise/shims',
    '/mise/bin'
  ])
})

test('adds only the bin directory when shims are disabled', () => {
  assert.deepEqual(misePathDirs('/mise/bin', '/mise/shims', false), [
    '/mise/bin'
  ])
})

test('the action never runs mise through a PATH lookup', () => {
  const source = fs.readFileSync(
    new URL('../src/index.ts', import.meta.url),
    'utf8'
  )
  const byName = [
    /exec\.(?:exec|getExecOutput)\(\s*'mise'/,
    /exec\.(?:exec|getExecOutput)\(\s*`mise[\s`]/,
    /exec\.(?:exec|getExecOutput)\(\s*"mise"/
  ]
  for (const pattern of byName) {
    assert.doesNotMatch(source, pattern)
  }
})
