import assert from 'node:assert/strict'
import test from 'node:test'
import { cacheKeyToSave, cachePathToSave } from '../src/cache-save.ts'

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

test('immediate saves reuse the selected installed cache path', () => {
  const installedPath = '/home/runner/.local/share/mise'
  const downloadCasPath = '/home/runner/.cache/mise/downloads-cas'

  assert.equal(cachePathToSave(undefined, installedPath, downloadCasPath), installedPath)
})

test('save path selection preserves post-step state and verified-downloads path', () => {
  const downloadCasPath = '/home/runner/.cache/mise/downloads-cas'

  assert.equal(
    cachePathToSave(undefined, downloadCasPath, '/fallback'),
    downloadCasPath
  )
  assert.equal(
    cachePathToSave('/post-step/cache-path', undefined, '/fallback'),
    '/post-step/cache-path'
  )
})
