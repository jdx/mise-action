import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as glob from '@actions/glob'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { rtxDir } from './utils'

async function run(): Promise<void> {
  try {
    await setToolVersions()
    await setRtxToml()

    if (core.getBooleanInput('cache')) {
      await restoreRTXCache()
    } else {
      core.setOutput('cache-hit', false)
    }

    const version = core.getInput('version')
    await setupRTX(version)
    await setEnvVars()
    await testRTX()
    if (core.getBooleanInput('install')) {
      await rtxInstall()
    }
  } catch (err) {
    if (err instanceof Error) core.setFailed(err.message)
    else throw err
  }
}

async function setEnvVars(): Promise<void> {
  core.startGroup('Setting env vars')
  const set = (k: string, v: string): void => {
    if (!process.env[k]) {
      core.info(`Setting ${k}=${v}`)
      core.exportVariable(k, v)
    }
  }
  set('RTX_TRUSTED_CONFIG_PATHS', process.cwd())
  set('RTX_YES', '1')

  const shimsDir = path.join(rtxDir(), 'shims')
  core.info(`Adding ${shimsDir} to PATH`)
  core.addPath(shimsDir)
}

async function restoreRTXCache(): Promise<void> {
  core.startGroup('Restoring rtx cache')
  const cachePath = rtxDir()
  const fileHash = await glob.hashFiles(`**/.tool-versions\n**/.rtx.toml`)
  const prefix = core.getInput('cache_key_prefix') || 'rtx-v0'
  const primaryKey = `${prefix}-${getOS()}-${os.arch()}-${fileHash}`

  core.saveState('CACHE', core.getBooleanInput('cache_save') ?? true)
  core.saveState('PRIMARY_KEY', primaryKey)
  core.saveState('RTX_DIR', cachePath)

  const cacheKey = await cache.restoreCache([cachePath], primaryKey)
  core.setOutput('cache-hit', Boolean(cacheKey))

  if (!cacheKey) {
    core.info(`rtx cache not found for ${primaryKey}`)
    return
  }

  core.saveState('CACHE_KEY', cacheKey)
  core.info(`rtx cache restored from key: ${cacheKey}`)
}

async function setupRTX(version: string | undefined): Promise<void> {
  core.startGroup(version ? `Setup rtx@${version}` : 'Setup rtx')
  const rtxBinDir = path.join(rtxDir(), 'bin')
  const url = version
    ? `https://rtx.jdx.dev/v${version}/rtx-v${version}-${getOS()}-${os.arch()}`
    : `https://rtx.jdx.dev/rtx-latest-${getOS()}-${os.arch()}`
  await fs.promises.mkdir(rtxBinDir, { recursive: true })
  await exec.exec('curl', [
    '-fsSL',
    url,
    '--output',
    path.join(rtxBinDir, 'rtx')
  ])
  await exec.exec('chmod', ['+x', path.join(rtxBinDir, 'rtx')])
  core.addPath(rtxBinDir)
}

async function setToolVersions(): Promise<void> {
  const toolVersions = core.getInput('tool_versions')
  if (toolVersions) {
    await writeFile('.tool-versions', toolVersions)
  }
}

async function setRtxToml(): Promise<void> {
  const toml = core.getInput('rtx_toml')
  if (toml) {
    await writeFile('.rtx.toml', toml)
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

const testRTX = async (): Promise<number> => rtx(['--version'])
const rtxInstall = async (): Promise<number> => rtx(['install'])
const rtx = async (args: string[]): Promise<number> =>
  core.group(`Running rtx ${args.join(' ')}`, async () => {
    const cwd = core.getInput('install_dir') || process.cwd()
    return exec.exec('rtx', args, { cwd })
  })

const writeFile = async (p: fs.PathLike, body: string): Promise<void> =>
  core.group(`Writing ${p}`, async () => {
    core.info(`Body:\n${body}`)
    await fs.promises.writeFile(p, body, { encoding: 'utf8' })
  })

run()
