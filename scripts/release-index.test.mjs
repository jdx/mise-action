import assert from 'node:assert/strict'
import test from 'node:test'
import { selectMiseRelease } from '../src/release-index.ts'

const cutoff = new Date('2026-09-28T00:00:00Z')
const at = Math.floor(cutoff.getTime() / 1000)

test('filters publication age inclusively, then orders mise versions numerically', () => {
  const index = `v2026.9.9\t${at}\nv2026.9.11\t${at + 1}\nv2026.9.10\t${at - 100}\nv2026.8.99\t${at}\n`
  assert.deepEqual(selectMiseRelease(index, cutoff), { version: '2026.9.10', publishedAt: at - 100 })
  assert.equal(selectMiseRelease(`v2026.9.11\t${at}\r\n`, cutoff).version, '2026.9.11')
})

test('returns no release for an empty index or an unsatisfied cutoff', () => {
  assert.equal(selectMiseRelease('\n', cutoff), undefined)
  assert.equal(selectMiseRelease(`v2026.9.11\t${at + 1}`, cutoff), undefined)
})

test('rejects malformed metadata even after a valid eligible release', () => {
  for (const invalid of ['<html>error</html>', 'v2026.9.16\tnope', 'v2026.9.16\t-1', 'v2026.9.16\t1\textra', 'v2026.9.16-rc1\t1', 'v2026.9.16\t9999999999999999999', 'v9999999999999999999.1.0\t1']) {
    assert.throws(() => selectMiseRelease(`v2026.1.0\t1\n${invalid}`, cutoff), /Invalid mise release index row/)
  }
  assert.throws(() => selectMiseRelease('', new Date(NaN)), /Invalid minimum release age cutoff/)
})
