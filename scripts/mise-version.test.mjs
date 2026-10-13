import assert from 'node:assert/strict'
import test from 'node:test'
import { supportsLockedInstall } from '../src/mise-version.ts'

test('locked installs require mise 2025.11.11 or newer', () => {
  assert.equal(supportsLockedInstall('mise 2025.11.10 linux-x64'), false)
  assert.equal(supportsLockedInstall('mise 2025.11.11 linux-x64'), true)
  assert.equal(supportsLockedInstall('mise 2025.12.0 linux-x64'), true)
  assert.equal(supportsLockedInstall('mise 2026.1.0 linux-x64'), true)
})

test('unrecognized mise version output is not treated as supported', () => {
  assert.equal(supportsLockedInstall('mise nightly linux-x64'), false)
  assert.equal(supportsLockedInstall('unexpected output'), false)
})
