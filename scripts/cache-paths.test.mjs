import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import {
  freshMiseDataDir,
  hasExplicitMiseDataDir,
  isDownloadCacheDisabled,
  miseCacheDir,
  miseDownloadCacheDir
} from '../src/cache-paths.ts'

test('resolves an explicit MISE_CACHE_DIR before XDG defaults', () => {
  assert.equal(
    miseCacheDir(
      { MISE_CACHE_DIR: '/custom/cache', XDG_CACHE_HOME: '/xdg' },
      'linux',
      '/home/user'
    ),
    '/custom/cache'
  )
})

test('resolves XDG and platform-specific cache defaults', () => {
  assert.equal(
    miseCacheDir({ XDG_CACHE_HOME: '/xdg' }, 'darwin', '/home/user'),
    '/xdg/mise'
  )
  assert.equal(miseCacheDir({}, 'linux', '/home/user'), '/home/user/.cache/mise')
  assert.equal(
    miseCacheDir({}, 'darwin', '/home/user'),
    '/home/user/Library/Caches/mise'
  )
  assert.equal(
    miseCacheDir({ TEMP: 'C:\\Temp' }, 'win32'),
    path.join('C:\\Temp', 'mise')
  )
})

test('caches only the download CAS and isolates default installed data by run', () => {
  assert.equal(
    miseDownloadCacheDir({ MISE_CACHE_DIR: '/cache' }, 'linux'),
    '/cache/downloads-cas'
  )
  assert.equal(
    freshMiseDataDir(
      {
        RUNNER_TEMP: '/tmp',
        GITHUB_RUN_ID: '123',
        GITHUB_RUN_ATTEMPT: '2'
      },
      undefined,
      '456'
    ),
    '/tmp/mise-action-data/123-2-456'
  )
})

test('recognizes mise download-cache disable values', () => {
  for (const value of ['0', 'false', 'FALSE', 'no', 'off']) {
    assert.equal(isDownloadCacheDisabled(value), true)
  }
  assert.equal(isDownloadCacheDisabled(undefined), false)
  assert.equal(isDownloadCacheDisabled('1'), false)
})

test('detects explicit data directory overrides that could restore installed tools', () => {
  assert.equal(hasExplicitMiseDataDir('/custom/mise', {}), true)
  assert.equal(hasExplicitMiseDataDir('', { MISE_DATA_DIR: '/custom/data' }), true)
  assert.equal(
    hasExplicitMiseDataDir('', {
      MISE_DATA_DIR: '/action-managed',
      MISE_ACTION_DATA_DIR: '/action-managed'
    }),
    false
  )
  assert.equal(hasExplicitMiseDataDir('', { MISE_INSTALLS_DIR: '/custom/installs' }), true)
  assert.equal(
    hasExplicitMiseDataDir('', { MISE_INSTALL_STORE_DIR: '/custom/store' }),
    true
  )
  assert.equal(hasExplicitMiseDataDir('', {}), false)
})
