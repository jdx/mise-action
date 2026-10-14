import assert from 'node:assert/strict'
import test from 'node:test'
import { cachePeriod } from '../src/cache-period.ts'

const day = 24 * 60 * 60 * 1000

test('is stable within a period and changes at its boundary', () => {
  assert.equal(cachePeriod(30, 30 * day), '1')
  assert.equal(cachePeriod(30, 59 * day + day - 1), '1')
  assert.equal(cachePeriod(30, 60 * day), '2')
})

test('is empty when disabled', () => {
  assert.equal(cachePeriod(0, 1000 * day), '')
})

test('rejects invalid values', () => {
  assert.throws(() => cachePeriod(-1), /non-negative integer/)
  assert.throws(() => cachePeriod(Number.NaN), /non-negative integer/)
  assert.throws(() => cachePeriod(1.5), /non-negative integer/)
})
