import process from 'node:process'
import assert from 'node:assert/strict'
import test from 'node:test'
import { configFileGlobs, templateUsesFileHash } from '../src/config-hash.ts'

test('globs are relative to each directory and never recurse', () => {
  process.env.GITHUB_WORKSPACE = '/ws'
  const globs = configFileGlobs('/ws/app/web')
  assert.ok(globs.includes('mise.toml'))
  assert.ok(globs.includes('app/mise.toml'))
  assert.ok(globs.includes('app/web/.tool-versions'))
  assert.ok(globs.includes('.config/mise/mise.lock'))
  assert.ok(globs.every(g => !g.includes('**')))
})

test('stops at the workspace and ignores a working directory outside it', () => {
  process.env.GITHUB_WORKSPACE = '/ws'
  assert.ok(configFileGlobs('/ws').every(g => !g.startsWith('..')))
  assert.deepEqual(configFileGlobs('/elsewhere'), [])
})

test('keeps directories whose names start with two dots', () => {
  process.env.GITHUB_WORKSPACE = '/ws'
  assert.ok(configFileGlobs('/ws/..app').includes('..app/mise.toml'))
})

test('escapes glob characters in directory names', () => {
  process.env.GITHUB_WORKSPACE = '/ws'
  assert.ok(configFileGlobs('/ws/a[1]').includes('a[[]1[]]/mise.toml'))
})

test('only template expressions that reach the file hash need it', () => {
  assert.equal(templateUsesFileHash('k-{{file_hash}}'), true)
  assert.equal(templateUsesFileHash('{{default}}-x'), true)
  assert.equal(templateUsesFileHash('{{#if file_hash}}a{{/if}}'), true)
  assert.equal(templateUsesFileHash('default-{{platform}}-file_hash'), false)
  assert.equal(templateUsesFileHash('{{this.file_hash}}'), true)
  assert.equal(templateUsesFileHash('{{./default}}'), true)
  assert.equal(templateUsesFileHash('{{lookup . "file_hash"}}'), true)
  assert.equal(templateUsesFileHash('static'), false)
})
