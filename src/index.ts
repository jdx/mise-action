import * as cache from '@actions/cache'
import * as io from '@actions/io'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as glob from '@actions/glob'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { miseDir } from './utils'

async function run(): Promise<void> {
  try {
    await setToolVersions()
    await setMiseToml()

    if (core.getBooleanInput('cache')) {
      await restoreMiseCache()
    } else {
      core.setOutput('cache-hit', false)
    }

    const version = core.getInput('version')
    await setupMise(version)
    await setEnvVars()
    await testMise()
    if (core.getBooleanInput('install')) {
      await miseInstall()
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
  if (core.getBooleanInput('experimental')) set('MISE_EXPERIMENTAL', '1')

  const logLevel = core.getInput('log_level')
  if (logLevel) set('MISE_LOG_LEVEL', logLevel)

  set('MISE_TRUSTED_CONFIG_PATHS', process.cwd())
  set('MISE_YES', '1')

  const shimsDir = path.join(miseDir(), 'shims')
  core.info(`Adding ${shimsDir} to PATH`)
  core.addPath(shimsDir)
}

async function restoreMiseCache(): Promise<void> {
  core.startGroup('Restoring mise cache')
  const version = core.getInput('version')
  const installArgs = core.getInput('install_args')
  const cachePath = miseDir()
  const fileHash = await glob.hashFiles(
    [
      `**/.config/mise/config.toml`,
      `**/.config/mise/config.lock`,
      `**/.config/mise/config.*.toml`,
      `**/.config/mise/config.*.lock`,
      `**/.config/mise.toml`,
      `**/.config/mise.lock`,
      `**/.config/mise.*.toml`,
      `**/.config/mise.*.lock`,
      `**/.mise/config.toml`,
      `**/.mise/config.lock`,
      `**/.mise/config.*.toml`,
      `**/.mise/config.*.lock`,
      `**/mise/config.toml`,
      `**/mise/config.lock`,
      `**/mise/config.*.toml`,
      `**/mise/config.*.lock`,
      `**/.mise.toml`,
      `**/.mise.lock`,
      `**/.mise.*.toml`,
      `**/.mise.*.lock`,
      `**/mise.toml`,
      `**/mise.lock`,
      `**/mise.*.toml`,
      `**/mise.*.lock`,
      `**/.tool-versions`
    ].join('\n')
  )
  const prefix = core.getInput('cache_key_prefix') || 'mise-v0'
  let primaryKey = `${prefix}-${getOS()}-${os.arch()}-${fileHash}`
  if (version) {
    primaryKey = `${primaryKey}-${version}`
  }
  if (installArgs) {
    const tools = installArgs
      .split(' ')
      .filter(arg => !arg.startsWith('-'))
      .sort()
      .join(' ')
    if (tools) {
      const toolsHash = crypto.createHash('sha256').update(tools).digest('hex')
      primaryKey = `${primaryKey}-${toolsHash}`
    }
  }

  core.saveState('CACHE', core.getBooleanInput('cache_save'))
  core.saveState('PRIMARY_KEY', primaryKey)
  core.saveState('MISE_DIR', cachePath)

  const cacheKey = await cache.restoreCache([cachePath], primaryKey)
  core.setOutput('cache-hit', Boolean(cacheKey))

  if (!cacheKey) {
    core.info(`mise cache not found for ${primaryKey}`)
    return
  }

  core.saveState('CACHE_KEY', cacheKey)
  core.info(`mise cache restored from key: ${cacheKey}`)
}

async function setupMise(version: string): Promise<void> {
  const miseBinDir = path.join(miseDir(), 'bin')
  const miseBinPath = path.join(
    miseBinDir,
    getOS() === 'windows' ? 'mise.exe' : 'mise'
  )
  if (!fs.existsSync(path.join(miseBinPath))) {
    core.startGroup(version ? `Download mise@${version}` : 'Setup mise')
    await fs.promises.mkdir(miseBinDir, { recursive: true })
    const url = version
      ? `https://mise.jdx.dev/v${version}/mise-v${version}-${getOS()}-${os.arch()}`
      : `https://mise.jdx.dev/mise-latest-${getOS()}-${os.arch()}`
    if (getOS() === 'windows') {
      const zipPath = path.join(os.tmpdir(), 'mise.zip')
      await exec.exec('curl', [
        '--compressed',
        '-fsSL',
        `${url}.zip`,
        '--output',
        zipPath
      ])
      await exec.exec('unzip', [zipPath, '-d', os.tmpdir()])
      await io.mv(path.join(os.tmpdir(), 'mise/bin/mise.exe'), miseBinPath)
    } else {
      await exec.exec('curl', [
        '--compressed',
        '-fsSL',
        url,
        '--output',
        miseBinPath
      ])
      await exec.exec('chmod', ['+x', miseBinPath])
    }
  }
  core.addPath(miseBinDir)
}

async function setToolVersions(): Promise<void> {
  const toolVersions = core.getInput('tool_versions')
  if (toolVersions) {
    await writeFile('.tool-versions', toolVersions)
  }
}

async function setMiseToml(): Promise<void> {
  const toml = core.getInput('mise_toml')
  if (toml) {
    await writeFile('mise.toml', toml)
  }
}

function getOS(): string {
  switch (process.platform) {
    case 'darwin':
      return 'macos'
    case 'win32':
      return 'windows'
    default:
      return process.platform
  }
}

const testMise = async (): Promise<number> => mise(['--version'])
const miseInstall = async (): Promise<number> =>
  mise([`install ${core.getInput('install_args')}`])
const mise = async (args: string[]): Promise<number> =>
  core.group(`Running mise ${args.join(' ')}`, async () => {
    const cwd =
      core.getInput('working_directory') ||
      core.getInput('install_dir') ||
      process.cwd()
    const env = core.isDebug()
      ? { ...process.env, MISE_LOG_LEVEL: 'debug' }
      : undefined

    if (args.length === 1) {
      return exec.exec(`mise ${args}`, [], {
        cwd,
        env
      })
    } else {
      return exec.exec('mise', args, { cwd, env })
    }
  })

const writeFile = async (p: fs.PathLike, body: string): Promise<void> =>
  core.group(`Writing ${p}`, async () => {
    core.info(`Body:\n${body}`)
    await fs.promises.writeFile(p, body, { encoding: 'utf8' })
  })

run()
