import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

async function run(): Promise<void> {
  await setupRTX()
  await setToolVersions()
  await exec.exec('rtx', ['--version'])
  await exec.exec('rtx', ['install'])
  await setPaths()
}

async function setupRTX(): Promise<void> {
  const rtxBinDir = path.join(os.homedir(), '.local/share/rtx/bin')
  const platform = `${getOS()}-${os.arch()}`
  await fs.promises.mkdir(rtxBinDir, {recursive: true})
  await exec.exec('gh', [
    'release',
    'download',
    '--clobber',
    '--pattern',
    `*${platform}`,
    '--repo',
    'jdxcode/rtx',
    '--output',
    path.join(rtxBinDir, 'rtx')
  ])
  await exec.exec('chmod', ['+x', path.join(rtxBinDir, 'rtx')])
  core.addPath(rtxBinDir)
}

async function setToolVersions(): Promise<void> {
  const toolVersions = core.getInput('tool_versions', {required: false})
  if (toolVersions) {
    await fs.promises.writeFile('.tool-versions', toolVersions, {
      encoding: 'utf8'
    })
  }
}

function getOS(): string {
  switch (process.platform) {
    case 'darwin':
      return 'macos'
    default:
      return process.platform
  }
}

async function setPaths(): Promise<void> {
  for (const binPath of await getBinPaths()) {
    core.addPath(binPath)
  }
}

async function getBinPaths(): Promise<string[]> {
  const output = await exec.getExecOutput('rtx', ['bin-paths'])
  return output.stdout.split('\n')
}

if (require.main === module) {
  try {
    run()
  } catch (err) {
    if (err instanceof Error) {
      core.setFailed(err.message)
    } else throw err
  }
}

export {run}
