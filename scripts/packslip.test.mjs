import assert from 'node:assert/strict'
import test from 'node:test'
import {
  packslipIdentity,
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

test('missing packslip reports false so callers can fall back', async () => {
  const v = fakeVerifier()
  assert.equal(
    await verifyAgainstPackslip(good, version, asset, async () => undefined, v),
    false
  )
  assert.deepEqual(v.calls, [])
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
