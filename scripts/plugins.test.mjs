import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePlugins } from '../src/plugins.ts'

test('parses names and name/url pairs, ignoring blanks and comments', () => {
  const input = `
    yarn
    # a comment
    php https://github.com/verzly/mise-php#latest   # trailing comment

  `
  assert.deepEqual(parsePlugins(input), [
    { name: 'yarn' },
    { name: 'php', url: 'https://github.com/verzly/mise-php#latest' }
  ])
})

test('accepts CRLF line endings', () => {
  assert.deepEqual(parsePlugins('yarn\r\nmake https://example.com/make.git\r\n'), [
    { name: 'yarn' },
    { name: 'make', url: 'https://example.com/make.git' }
  ])
})

test('returns nothing for empty input', () => {
  assert.deepEqual(parsePlugins(''), [])
  assert.deepEqual(parsePlugins('  \n# only a comment\n'), [])
})

test('rejects malformed entries and option-like values', () => {
  assert.throws(() => parsePlugins('a b c'), /Invalid plugins entry/)
  assert.throws(() => parsePlugins('--force'), /Invalid plugins entry/)
  assert.throws(() => parsePlugins('name --force'), /Invalid plugins entry/)
})

test('ignores exact duplicates and rejects conflicting sources for one name', () => {
  assert.deepEqual(parsePlugins('yarn\nyarn\n'), [{ name: 'yarn' }])
  assert.throws(
    () => parsePlugins('php https://example.com/a.git\nphp https://example.com/b.git'),
    /Conflicting plugins entries for "php"/
  )
  assert.throws(
    () => parsePlugins('php\nphp https://example.com/a.git'),
    /Conflicting plugins entries for "php"/
  )
})
