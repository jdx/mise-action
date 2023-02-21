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

interface GHAsset {
  name: string
  url: string
  browser_download_url: string
}

interface GHAssets {
  assets: GHAsset[]
}

async function getLatestRTXAssetURL(): Promise<string> {
  const output = await exec.getExecOutput(
    'curl',
    ['-sSf', 'https://api.github.com/repos/jdxcode/rtx/releases/latest'],
    {silent: true}
  )
  const json: GHAssets = JSON.parse(output.stdout)
  const platform = `${getOS()}-${os.arch()}`
  const asset = json.assets.find(a => a.name.endsWith(platform))
  if (!asset) {
    const assets = json.assets.map(a => a.name).join(', ')
    throw new Error(`No asset for ${platform}, got: ${assets}`)
  }
  return asset.browser_download_url
}

async function setupRTX(): Promise<void> {
  const rtxBinDir = path.join(os.homedir(), '.local/share/rtx/bin')
  await fs.promises.mkdir(rtxBinDir, {recursive: true})
  await exec.exec('curl', [
    '-sSfL',
    '--compressed',
    '--output',
    path.join(rtxBinDir, 'rtx'),
    await getLatestRTXAssetURL()
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
