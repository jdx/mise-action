import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { moveFile, tempRoot } from '../src/file-move.ts'

const exdev = () =>
  Object.assign(new Error('cross-device link not permitted'), {
    code: 'EXDEV'
  })

function realOps(mv) {
  return {
    mv,
    copyFile: (s, d) => fs.promises.copyFile(s, d),
    unlink: p => fs.promises.unlink(p)
  }
}

test('prefers RUNNER_TEMP when it exists', () => {
  assert.equal(
    tempRoot({ RUNNER_TEMP: 'D:\\a\\_temp' }, 'C:\\Temp', () => true),
    'D:\\a\\_temp'
  )
})

test('falls back when RUNNER_TEMP is unset or missing', () => {
  assert.equal(tempRoot({}, '/tmp', () => true), '/tmp')
  assert.equal(tempRoot({ RUNNER_TEMP: '' }, '/tmp', () => true), '/tmp')
  assert.equal(
    tempRoot({ RUNNER_TEMP: '/nope' }, '/tmp', () => false),
    '/tmp'
  )
})

test('copies and removes the source when the rename hits EXDEV', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-move-'))
  const src = path.join(dir, 'src.exe')
  const dest = path.join(dir, 'dest.exe')
  fs.writeFileSync(src, 'mise')
  await moveFile(
    src,
    dest,
    realOps(async () => {
      throw exdev()
    })
  )
  assert.equal(fs.readFileSync(dest, 'utf8'), 'mise')
  assert.equal(fs.existsSync(src), false)
})

test('does not copy when the rename succeeds', async () => {
  const calls = []
  await moveFile('a', 'b', {
    mv: async () => calls.push('mv'),
    copyFile: async () => calls.push('copy'),
    unlink: async () => calls.push('unlink')
  })
  assert.deepEqual(calls, ['mv'])
})

test('rethrows other errors', async () => {
  const err = Object.assign(new Error('denied'), { code: 'EACCES' })
  await assert.rejects(
    moveFile(
      'a',
      'b',
      realOps(async () => {
        throw err
      })
    ),
    err
  )
})
