import assert from 'node:assert/strict'
import test from 'node:test'
import { cacheKeyToSave } from '../src/cache-save.ts'

const primary = 'mise-v1-linux-x64-abc'

test('saves under the primary key after a cache miss', () => {
  assert.equal(cacheKeyToSave(primary, undefined), primary)
})

test('saves under the primary key after a prefix-matched restore', () => {
  assert.equal(cacheKeyToSave(primary, `${primary}-extra`), primary)
})

test('skips saving after an exact hit', () => {
  assert.equal(cacheKeyToSave(primary, primary), undefined)
})
