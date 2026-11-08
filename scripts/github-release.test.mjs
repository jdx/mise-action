import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assetApiUrl,
  downloadReleaseAsset,
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
    'https://github.com/jdx/mise/releases/download/v1/%E0%A4%A',
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

const ref = {
  owner: 'jdx',
  repo: 'mise',
  tag: 'v1',
  name: 'mise.tar.gz'
}

function fakeRequest(release) {
  const calls = []
  const request = async (url, headers, filePath) => {
    calls.push({ url, headers, filePath })
    if (url.endsWith('/releases/tags/v1')) {
      if (release instanceof Error) throw release
      return JSON.stringify(release)
    }
    return ''
  }
  return { calls, request }
}

test('downloads the asset through the API with the token', async () => {
  const { calls, request } = fakeRequest({
    assets: [{ name: 'mise.tar.gz', url: 'https://api.github.com/assets/7' }]
  })
  assert.equal(await downloadReleaseAsset(ref, 't0k', request, '/f'), '')
  assert.deepEqual(calls, [
    {
      url: 'https://api.github.com/repos/jdx/mise/releases/tags/v1',
      headers: ['Authorization: Bearer t0k', 'Accept: application/vnd.github+json'],
      filePath: undefined
    },
    {
      url: 'https://api.github.com/assets/7',
      headers: ['Authorization: Bearer t0k', 'Accept: application/octet-stream'],
      filePath: '/f'
    }
  ])
})

test('returns null when the release does not list the asset', async () => {
  const { calls, request } = fakeRequest({ assets: [] })
  assert.equal(await downloadReleaseAsset(ref, 't0k', request), null)
  assert.equal(calls.length, 1)
})

test('throws the API error so the caller can fall back', async () => {
  const { request } = fakeRequest(new Error('HTTP 504'))
  await assert.rejects(downloadReleaseAsset(ref, 't0k', request), /HTTP 504/)
})
