import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { setupGitHubToken } from '../src/github-token.ts'

const cases = [
  { name: 'default keeps the input token local', input: 'action-token' },
  {
    name: 'false keeps the input token local',
    input: 'action-token',
    persist: 'false'
  },
  {
    name: 'FALSE keeps the input token local',
    input: 'action-token',
    persist: 'FALSE'
  },
  {
    name: 'true persists the input token',
    input: 'action-token',
    persist: 'true',
    exported: 'action-token'
  },
  {
    name: 'TRUE persists the input token',
    input: 'action-token',
    persist: 'TRUE',
    exported: 'action-token'
  },
  {
    name: 'a separate token is persisted without replacing the action token',
    input: 'action-token',
    persist: 'read-only-token',
    exported: 'read-only-token'
  },
  {
    name: 'an existing environment token wins and stays local by default',
    input: 'action-token',
    existing: 'env-token'
  },
  {
    name: 'true persists the existing environment token',
    input: 'action-token',
    existing: 'env-token',
    persist: 'true',
    exported: 'env-token'
  },
  {
    name: 'a separate token is persisted without replacing an environment token',
    input: 'action-token',
    existing: 'env-token',
    persist: 'read-only-token',
    exported: 'read-only-token'
  },
  {
    name: 'an empty environment token falls back to the input',
    input: 'action-token',
    existing: ''
  },
  { name: 'missing credentials remain unset' },
  { name: 'true with no credential exports nothing', persist: 'true' },
  {
    name: 'a persistence-only token is not used by this action',
    persist: 'read-only-token',
    exported: 'read-only-token'
  }
]

for (const entry of cases) {
  test(entry.name, t => {
    const keys = [
      'GITHUB_ENV',
      'INPUT_GITHUB_TOKEN',
      'INPUT_PERSIST_GITHUB_TOKEN',
      'MISE_GITHUB_TOKEN',
      'GITHUB_TOKEN'
    ]
    const previous = Object.fromEntries(
      keys.map(key => [key, process.env[key]])
    )
    const dir = mkdtempSync(join(tmpdir(), 'mise-action-github-token-'))
    t.after(() => {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key]
        else process.env[key] = previous[key]
      }
      rmSync(dir, { recursive: true, force: true })
    })

    const envFile = join(dir, 'env')
    writeFileSync(envFile, '')
    process.env.GITHUB_ENV = envFile
    process.env.INPUT_GITHUB_TOKEN = entry.input || ''
    process.env.INPUT_PERSIST_GITHUB_TOKEN = entry.persist || ''
    process.env.GITHUB_TOKEN = 'unrelated-token'
    if (entry.existing === undefined) delete process.env.MISE_GITHUB_TOKEN
    else process.env.MISE_GITHUB_TOKEN = entry.existing

    setupGitHubToken()

    const actionToken = entry.existing || entry.input
    assert.equal(process.env.MISE_GITHUB_TOKEN, actionToken)
    assert.equal(process.env.GITHUB_TOKEN, 'unrelated-token')
    // Verify that child processes used to install tools inherit the action
    // credential, including when a different token is persisted for later.
    const childToken = execFileSync(
      process.execPath,
      ['-e', 'process.stdout.write(process.env.MISE_GITHUB_TOKEN || "")'],
      { encoding: 'utf8' }
    )
    assert.equal(childToken, actionToken || '')

    const exported = readFileSync(envFile, 'utf8')
    if (entry.exported) {
      assert.match(exported, /^MISE_GITHUB_TOKEN<</)
      assert.equal(exported.trimEnd().split('\n')[1], entry.exported)
      if (actionToken !== entry.exported && actionToken) {
        assert.ok(!exported.includes(actionToken))
      }
    } else {
      assert.equal(exported, '')
    }
  })
}
