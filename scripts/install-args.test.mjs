import assert from 'node:assert/strict'
import test from 'node:test'
import { buildInstallCommand } from '../src/install-args.ts'

test('adds monorepo and locked flags without disturbing install args', () => {
  assert.equal(
    buildInstallCommand('bun', true, true),
    'install --locked --monorepo bun'
  )
})

test('verified-downloads mode can force locked installs', () => {
  assert.equal(buildInstallCommand('node', true, false), 'install --locked node')
})

test('does not duplicate flags already passed explicitly', () => {
  assert.equal(
    buildInstallCommand(' --locked --monorepo bun ', true, true),
    'install --locked --monorepo bun'
  )
})

test('leaves monorepo disabled when opted out', () => {
  assert.equal(buildInstallCommand('bun', false, false), 'install bun')
})
