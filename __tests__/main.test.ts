import * as process from 'process'
import * as cp from 'child_process'
import * as path from 'path'
import {expect, test, jest} from '@jest/globals'
import {run} from '../src/main'
import {exec} from '@actions/exec'

jest.mock('@actions/exec')

// shows how the runner will run a javascript action with env / stdout protocol
test('install', async () => {
  await run()
  expect(exec).toBeCalledWith('rtx', ['install'])
})
