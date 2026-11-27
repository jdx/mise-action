import assert from 'node:assert/strict'
import test from 'node:test'
import { workspaceDataDir } from '../src/data-dir.ts'

const hosted = {
  GITHUB_WORKSPACE: 'D:\\a\\repo\\repo',
  RUNNER_ENVIRONMENT: 'github-hosted',
  SYSTEMDRIVE: 'C:'
}

test('uses the workspace drive on a hosted Windows runner', () => {
  assert.equal(workspaceDataDir(hosted, 'win32'), 'D:\\mise')
})

test('keeps the default when the workspace is on the system drive', () => {
  for (const workspace of ['C:\\actions\\repo', 'c:\\actions\\repo']) {
    assert.equal(
      workspaceDataDir({ ...hosted, GITHUB_WORKSPACE: workspace }, 'win32'),
      undefined
    )
  }
})

test('leaves a configured data directory alone', () => {
  for (const configured of [
    { MISE_DATA_DIR: 'E:\\tools' },
    { XDG_DATA_HOME: 'E:\\data' }
  ]) {
    assert.equal(
      workspaceDataDir({ ...hosted, ...configured }, 'win32'),
      undefined
    )
  }
})

test('keeps the default on self-hosted runners', () => {
  for (const runner of ['self-hosted', undefined]) {
    assert.equal(
      workspaceDataDir({ ...hosted, RUNNER_ENVIRONMENT: runner }, 'win32'),
      undefined
    )
  }
})

test('does nothing off Windows or without a workspace', () => {
  assert.equal(workspaceDataDir(hosted, 'linux'), undefined)
  assert.equal(workspaceDataDir(hosted, 'darwin'), undefined)
  assert.equal(
    workspaceDataDir({ ...hosted, GITHUB_WORKSPACE: undefined }, 'win32'),
    undefined
  )
})

test('uses the workspace drive when the system drive is unknown', () => {
  assert.equal(
    workspaceDataDir({ ...hosted, SYSTEMDRIVE: undefined }, 'win32'),
    'D:\\mise'
  )
})
