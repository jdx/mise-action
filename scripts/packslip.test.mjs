import assert from 'node:assert/strict'
import test from 'node:test'
import {
  packslipIdentity,
  packslipRequired,
  packslipUrl,
  verifyAgainstPackslip
} from '../src/packslip.ts'

const version = '2026.10.11'
const asset = `mise-v${version}-linux-x64.tar.gz`
const good = 'a'.repeat(64)

// A fake verifier that enforces the same checks the real one does.
function fakeVerifier({
  identity = packslipIdentity(version),
  tag = `v${version}`,
  digests = { [asset]: good }
} = {}) {
  const calls = []
  return {
    calls,
    async verifyRelease(bundle, options) {
      calls.push(options)
      if (options.identity !== identity) throw new Error('identity mismatch')
      if (options.tag !== tag) throw new Error('tag mismatch')
      return { digests }
    },
    findArtifact(statement, name) {
      if (!(name in statement.digests)) throw new Error(`no artifact ${name}`)
      return { name, sha256: statement.digests[name] }
    },
    async verifyFileDigest(path, artifact) {
      if (artifact.sha256 !== path) throw new Error('digest mismatch')
    }
  }
}
const bundle = async () => '{}'

test('urls and identity', () => {
  assert.equal(
    packslipUrl(version),
    'https://github.com/jdx/mise/releases/download/v2026.10.11/packslip.sigstore.json'
  )
  assert.equal(
    packslipIdentity(version),
    'https://github.com/jdx/mise/.github/workflows/release.yml@refs/tags/v2026.10.11'
  )
})

test('valid packslip verifies and pins identity, issuer, project and tag', async () => {
  const v = fakeVerifier()
  // the fake treats the file path as its digest
  assert.equal(
    await verifyAgainstPackslip(good, version, asset, bundle, v),
    true
  )
  assert.deepEqual(v.calls, [
    {
      identity: packslipIdentity(version),
      issuer: 'https://token.actions.githubusercontent.com',
      project: 'github.com/jdx/mise',
      tag: `v${version}`
    }
  ])
})

test('tampered digest throws', async () => {
  await assert.rejects(
    verifyAgainstPackslip(
      'b'.repeat(64),
      version,
      asset,
      bundle,
      fakeVerifier()
    ),
    /digest mismatch/
  )
})

test('wrong identity or tag throws', async () => {
  await assert.rejects(
    verifyAgainstPackslip(
      good,
      version,
      asset,
      bundle,
      fakeVerifier({ identity: 'https://evil/x@refs/tags/v1' })
    ),
    /identity mismatch/
  )
  await assert.rejects(
    verifyAgainstPackslip(
      good,
      version,
      asset,
      bundle,
      fakeVerifier({ tag: 'v1.0.0' })
    ),
    /tag mismatch/
  )
})

test('asset missing from the packslip throws', async () => {
  await assert.rejects(
    verifyAgainstPackslip(
      good,
      version,
      asset,
      bundle,
      fakeVerifier({ digests: {} })
    ),
    /no artifact/
  )
})

test('a release before the first packslip reports false so callers can fall back', async () => {
  const v = fakeVerifier()
  assert.equal(
    await verifyAgainstPackslip(
      good,
      '2026.9.2',
      asset,
      async () => undefined,
      v
    ),
    false
  )
  assert.deepEqual(v.calls, [])
})

test('a missing packslip on a release that must have one throws', async () => {
  const v = fakeVerifier()
  await assert.rejects(
    verifyAgainstPackslip(good, version, asset, async () => undefined, v),
    /must ship a signed packslip/
  )
  assert.deepEqual(v.calls, [])
})

test('packslipRequired starts at 2026.9.3', () => {
  for (const v of [
    '2026.9.3',
    '2026.9.18',
    '2026.10.0',
    '2027.1.0',
    '2026.10.11'
  ]) {
    assert.equal(packslipRequired(v), true, v)
  }
  for (const v of ['2026.9.2', '2026.8.16', '2025.12.31', '2026.9.0']) {
    assert.equal(packslipRequired(v), false, v)
  }
  assert.equal(packslipRequired('not-a-version'), true)
  assert.equal(packslipRequired('2026.9.2-extra'), true)
})

test('a failed verification throws instead of falling back', async () => {
  const v = fakeVerifier()
  v.verifyRelease = async () => {
    throw new Error('signature invalid')
  }
  await assert.rejects(
    verifyAgainstPackslip(good, version, asset, bundle, v),
    /signature invalid/
  )
  // a fetch error other than "not found" also propagates
  await assert.rejects(
    verifyAgainstPackslip(
      good,
      version,
      asset,
      async () => {
        throw new Error('HTTP 500')
      },
      fakeVerifier()
    ),
    /HTTP 500/
  )
})
