import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assetApiUrl,
  parseReleaseDownloadUrl,
  releaseByTagApiUrl
} from '../src/github-release.ts'

test('parses github.com release download URLs only', () => {
  const ref = parseReleaseDownloadUrl(
    'https://github.com/jdx/mise/releases/download/v2026.10.19/SHASUMS256.txt'
  )
  assert.deepEqual(ref, {
    owner: 'jdx',
    repo: 'mise',
    tag: 'v2026.10.19',
    name: 'SHASUMS256.txt'
  })
  assert.equal(
    releaseByTagApiUrl(ref),
    'https://api.github.com/repos/jdx/mise/releases/tags/v2026.10.19'
  )
  for (const url of [
    'http://github.com/jdx/mise/releases/download/v1/x',
    'https://mise.jdx.dev/v1/x',
    'https://github.com.evil.example/jdx/mise/releases/download/v1/x',
    'https://github.com/jdx/mise/releases/download/v1/x?token=1',
    'https://github.com/jdx/mise/releases/latest/download/x',
    'https://github.com/jdx/mise/releases/download/v1/a/b',
    'not a url'
  ]) {
    assert.equal(parseReleaseDownloadUrl(url), undefined, url)
  }
})

test('finds the asset API URL by exact name', () => {
  const json = JSON.stringify({
    assets: [
      { name: 'SHASUMS256.txt.minisig', url: 'https://api.github.com/a/2' },
      { name: 'SHASUMS256.txt', url: 'https://api.github.com/a/1' },
      { name: 'evil', url: 'https://example.com/a/3' }
    ]
  })
  assert.equal(assetApiUrl(json, 'SHASUMS256.txt'), 'https://api.github.com/a/1')
  assert.equal(assetApiUrl(json, 'missing'), undefined)
  assert.equal(assetApiUrl(json, 'evil'), undefined)
  assert.equal(assetApiUrl('{}', 'SHASUMS256.txt'), undefined)
})
