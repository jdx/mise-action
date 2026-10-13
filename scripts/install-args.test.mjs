import assert from 'node:assert/strict'
import test from 'node:test'
import { buildInstallCommand } from '../src/install-args.ts'

test('adds monorepo and locked flags without disturbing install args', () => {
  assert.equal(
    buildInstallCommand('bun', true, true),
    'install --locked --monorepo bun'
  )
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
