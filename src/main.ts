import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as glob from '@actions/glob'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {rtxDir} from './utils'

async function run(): Promise<void> {
  await setToolVersions()
  await restoreRTXCache()
  await setupRTX()
  await setEnvVars()
  await exec.exec('rtx', ['--version'])
  await exec.exec('rtx', ['install'])
  await setPaths()
}

async function setEnvVars(): Promise<void> {
  if (!process.env['RTX_TRUSTED_CONFIG_PATHS']) {
    core.exportVariable(
      'RTX_TRUSTED_CONFIG_PATHS',
      path.join(process.cwd(), '.rtx.toml')
    )
  }
  if (!process.env['RTX_YES']) {
    core.exportVariable('RTX_YES', 'yes')
  }
}

async function restoreRTXCache(): Promise<void> {
  const cachePath = rtxDir()
  const fileHash = await glob.hashFiles(`**/.tool-versions\n**/.rtx.toml`)
  const primaryKey = `rtx-tools-${getOS()}-${os.arch()}-${fileHash}`

  core.saveState('PRIMARY_KEY', primaryKey)

  const cacheKey = await cache.restoreCache([cachePath], primaryKey)
  core.setOutput('cache-hit', Boolean(cacheKey))

  if (!cacheKey) {
    core.info(`rtx cache not found for ${getOS()}-${os.arch()} tool versions`)
    return
  }

  core.saveState('CACHE_KEY', cacheKey)
  core.info(`rtx cache restored from key: ${cacheKey}`)
}

async function setupRTX(): Promise<void> {
  const rtxBinDir = path.join(rtxDir(), 'bin')
  const url = `https://rtx.pub/rtx-latest-${getOS()}-${os.arch()}`
  await fs.promises.mkdir(rtxBinDir, {recursive: true})
  await exec.exec('curl', [url, '--output', path.join(rtxBinDir, 'rtx')])
  await exec.exec('chmod', ['+x', path.join(rtxBinDir, 'rtx')])
  core.addPath(rtxBinDir)
}

// returns true if tool_versions was set
async function setToolVersions(): Promise<Boolean> {
  const toolVersions = core.getInput('tool_versions', {required: false})
  if (toolVersions) {
    await fs.promises.writeFile('.tool-versions', toolVersions, {
      encoding: 'utf8'
    })
    return true
  }
  return false
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
