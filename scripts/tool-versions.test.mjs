import assert from 'node:assert/strict'
import test from 'node:test'
import { toolVersionOutputs } from '../src/tool-versions.ts'

const entry = (version, extra = {}) => ({
  version,
  requested_version: version.split('.')[0],
  install_path: `/mise/installs/x/${version}`,
  source: { type: 'mise.toml', path: '/repo/mise.toml' },
  installed: true,
  active: true,
  ...extra
})

test('reports the first active version per tool and all versions as JSON', () => {
  const { versions, outputs } = toolVersionOutputs({
    bun: [entry('1.2.3')],
    node: [entry('22.1.0'), entry('20.5.0')]
  })
  assert.deepEqual(outputs, { bun: '1.2.3', node: '22.1.0' })
  assert.equal(versions.node.length, 2)
  assert.equal(versions.bun[0].requested_version, '1')
})

test('skips inactive and uninstalled entries', () => {
  const { versions, outputs } = toolVersionOutputs({
    bun: [entry('1.0.0', { active: false })],
    node: [entry('22.1.0', { installed: false })],
    go: [entry('1.23.0', { active: false }), entry('1.24.0')]
  })
  assert.deepEqual(outputs, { go: '1.24.0' })
  assert.deepEqual(Object.keys(versions), ['go'])
})

test('keeps tools without a referenceable output name in versions only', () => {
  const { versions, outputs } = toolVersionOutputs({
    'npm:@scope/pkg': [entry('1.0.0')],
    'cache-hit': [entry('2.0.0')],
    versions: [entry('3.0.0')],
    python: [entry('3.13.1')]
  })
  assert.deepEqual(outputs, { python: '3.13.1' })
  assert.deepEqual(Object.keys(versions).sort(), [
    'cache-hit',
    'npm:@scope/pkg',
    'python',
    'versions'
  ])
})

test('tolerates unexpected shapes', () => {
  for (const bad of [undefined, null, [], 'x', 1, { node: 'x' }, { node: [null, 5, {}] }]) {
    assert.deepEqual(toolVersionOutputs(bad), { versions: {}, outputs: {} })
  }
})
