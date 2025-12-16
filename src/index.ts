import * as cache from '@actions/cache'
import * as io from '@actions/io'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as glob from '@actions/glob'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as Handlebars from 'handlebars'

// Configuration file patterns for cache key generation
const MISE_CONFIG_FILE_PATTERNS = [
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
]

// Default cache key template
const DEFAULT_CACHE_KEY_TEMPLATE =
  '{{cache_key_prefix}}-{{platform}}-{{file_hash}}{{#if version}}-{{version}}{{/if}}{{#if mise_env}}-{{mise_env}}{{/if}}{{#if install_args_hash}}-{{install_args_hash}}{{/if}}'

async function run(): Promise<void> {
  try {
    await setToolVersions()
    await setMiseToml()

    let cacheKey: string | undefined
    if (core.getBooleanInput('cache')) {
      cacheKey = await restoreMiseCache()
    } else {
      core.setOutput('cache-hit', false)
    }

    const version = core.getInput('version')
    const fetchFromGitHub = core.getBooleanInput('fetch_from_github')
    await setupMise(version, fetchFromGitHub)
    await setEnvVars()
    if (core.getBooleanInput('reshim')) {
      await miseReshim()
    }
    await testMise()
    if (core.getBooleanInput('install')) {
      await miseInstall()
      if (cacheKey && core.getBooleanInput('cache_save')) {
        await saveCache(cacheKey)
      }
    }
    await miseLs()
    const loadEnv = core.getBooleanInput('env')
    if (loadEnv) {
      await exportMiseEnv()
    }
  } catch (err) {
    if (err instanceof Error) core.setFailed(err.message)
    else throw err
  }
}

async function exportMiseEnv(): Promise<void> {
  core.startGroup('Exporting mise environment variables')

  // Check if mise supports --redacted flags based on version input
  const supportsRedacted = checkMiseSupportsRedacted()

  if (supportsRedacted) {
    try {
      // First, get the redacted values to identify what needs masking
      const redactedOutput = await exec.getExecOutput(
        'mise',
        ['env', '--redacted', '--json'],
        { silent: true }
      )
      const redactedVars = JSON.parse(redactedOutput.stdout)

      // Mask sensitive values in GitHub Actions
      for (const [key, actualValue] of Object.entries(redactedVars)) {
        core.setSecret(actualValue as string)
        core.info(`Masked sensitive value for: ${key}`)
      }

      // Then get the actual values
      const actualOutput = await exec.getExecOutput('mise', ['env', '--json'])
      const actualVars = JSON.parse(actualOutput.stdout)

      // Export all environment variables
      for (const [key, value] of Object.entries(actualVars)) {
        if (typeof value === 'string') {
          core.exportVariable(key, value)
        }
      }
    } catch {
      // Fall back to dotenv format if the redacted command fails
      core.info('Falling back to dotenv format')
      const output = await exec.getExecOutput('mise', ['env', '--dotenv'])
      fs.appendFileSync(process.env.GITHUB_ENV!, output.stdout)
    }
  } else {
    // Fall back to the old --dotenv format for older versions
    const output = await exec.getExecOutput('mise', ['env', '--dotenv'])
    fs.appendFileSync(process.env.GITHUB_ENV!, output.stdout)
  }

  core.endGroup()
}

function cleanVersion(version: string) {
  // remove 'v' prefix if present
  return version.replace(/^v/, '')
}

function checkMiseSupportsRedacted(): boolean {
  const version = core.getInput('version')

  // If no version is specified, assume latest which supports redacted
  if (!version) {
    return true
  }

  const versionMatch = cleanVersion(version).match(/^(\d+)\.(\d+)\.(\d+)/)

  if (!versionMatch) {
    // If we can't parse the version, assume it supports redacted
    return true
  }

  const [, year, month, patch] = versionMatch
  const yearNum = parseInt(year, 10)
  const monthNum = parseInt(month, 10)
  const patchNum = parseInt(patch, 10)

  // Check if version is >= 2025.8.17
  if (yearNum > 2025) return true
  if (yearNum === 2025) {
    if (monthNum > 8) return true
    if (monthNum === 8 && patchNum >= 17) return true
  }

  return false
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

  const githubToken = core.getInput('github_token')
  if (githubToken) {
    // Don't use GITHUB_TOKEN, use MISE_GITHUB_TOKEN instead to avoid downstream issues.
    set('MISE_GITHUB_TOKEN', githubToken)
  } else {
    core.warning(
      'No MISE_GITHUB_TOKEN provided. You may hit GitHub API rate limits when installing tools from GitHub.'
    )
  }

  set('MISE_TRUSTED_CONFIG_PATHS', process.cwd())
  set('MISE_YES', '1')

  const shimsDir = path.join(miseDir(), 'shims')
  core.info(`Adding ${shimsDir} to PATH`)
  core.addPath(shimsDir)
}

async function restoreMiseCache(): Promise<string | undefined> {
  core.startGroup('Restoring mise cache')
  const cachePath = miseDir()

  // Use custom cache key if provided, otherwise use default template
  const cacheKeyTemplate =
    core.getInput('cache_key') || DEFAULT_CACHE_KEY_TEMPLATE
  const primaryKey = await processCacheKeyTemplate(cacheKeyTemplate)

  core.saveState('PRIMARY_KEY', primaryKey)
  core.saveState('MISE_DIR', cachePath)

  const cacheKey = await cache.restoreCache([cachePath], primaryKey)
  core.setOutput('cache-hit', Boolean(cacheKey))

  if (!cacheKey) {
    core.info(`mise cache not found for ${primaryKey}`)
    return primaryKey
  }

  core.info(`mise cache restored from key: ${cacheKey}`)
}

async function setupMise(
  version: string,
  fetchFromGitHub = false
): Promise<void> {
  const miseBinDir = path.join(miseDir(), 'bin')
  const miseBinPath = path.join(
    miseBinDir,
    process.platform === 'win32' ? 'mise.exe' : 'mise'
  )
  if (!fs.existsSync(path.join(miseBinPath))) {
    core.startGroup(version ? `Download mise@${version}` : 'Setup mise')
    await fs.promises.mkdir(miseBinDir, { recursive: true })
    const ext =
      process.platform === 'win32'
        ? '.zip'
        : version && version.startsWith('2024')
          ? ''
          : (await zstdInstalled())
            ? '.tar.zst'
            : '.tar.gz'
    let resolvedVersion = version || (await latestMiseVersion())
    resolvedVersion = resolvedVersion.replace(/^v/, '')
    let url: string
    if (!fetchFromGitHub && !version) {
      // Only for latest version
      url = `https://mise.jdx.dev/mise-latest-${await getTarget()}${ext}`
    } else {
      url = `https://github.com/jdx/mise/releases/download/v${resolvedVersion}/mise-v${resolvedVersion}-${await getTarget()}${ext}`
    }
    const archivePath = path.join(os.tmpdir(), `mise${ext}`)
    switch (ext) {
      case '.zip':
        await exec.exec('curl', ['-fsSL', url, '--output', archivePath])
        await exec.exec('unzip', [archivePath, '-d', os.tmpdir()])
        await io.mv(path.join(os.tmpdir(), 'mise/bin/mise.exe'), miseBinPath)
        break
      case '.tar.zst':
        await exec.exec('sh', [
          '-c',
          `curl -fsSL ${url} | tar --zstd -xf - -C ${os.tmpdir()} && mv ${os.tmpdir()}/mise/bin/mise ${miseBinPath}`
        ])
        break
      case '.tar.gz':
        await exec.exec('sh', [
          '-c',
          `curl -fsSL ${url} | tar -xzf - -C ${os.tmpdir()} && mv ${os.tmpdir()}/mise/bin/mise ${miseBinPath}`
        ])
        break
      default:
        await exec.exec('sh', ['-c', `curl -fsSL ${url} > ${miseBinPath}`])
        await exec.exec('chmod', ['+x', miseBinPath])
        break
    }
  } else {
    const requestedVersion = cleanVersion(core.getInput('version'))
    if (requestedVersion !== '') {
      const versionOutput = await exec.getExecOutput(
        miseBinPath,
        ['version', '--json'],
        { silent: true }
      )
      const versionJson = JSON.parse(versionOutput.stdout)
      const version = cleanVersion(versionJson.version.split(' ')[0])
      if (requestedVersion === version) {
        core.info(`mise already installed`)
      } else {
        core.info(
          `mise already installed (${version}), but different version requested (${requestedVersion})`
        )
        await exec.exec(miseBinPath, ['self-update', requestedVersion, '-y'], {
          silent: true
        })
        core.info(`mise updated to version ${requestedVersion}`)
      }
    }
  }
  // compare with provided hash
  const want = core.getInput('sha256')
  if (want) {
    const hash = crypto.createHash('sha256')
    const fileBuffer = await fs.promises.readFile(miseBinPath)
    const got = hash.update(fileBuffer).digest('hex')
    if (got !== want) {
      throw new Error(
        `SHA256 mismatch: expected ${want}, got ${got} for ${miseBinPath}`
      )
    }
  }

  core.addPath(miseBinDir)
}

async function zstdInstalled(): Promise<boolean> {
  try {
    await exec.exec('zstd', ['--version'])
    return true
  } catch {
    return false
  }
}

async function latestMiseVersion(): Promise<string> {
  const rsp = await exec.getExecOutput('curl', [
    '-fsSL',
    'https://mise.jdx.dev/VERSION'
  ])
  return rsp.stdout.trim()
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

const testMise = async (): Promise<number> => mise(['--version'])
const miseInstall = async (): Promise<number> =>
  mise([`install ${core.getInput('install_args')}`])
const miseLs = async (): Promise<number> => mise([`ls`])
const miseReshim = async (): Promise<number> => mise([`reshim`, `-f`])
const mise = async (args: string[]): Promise<number> =>
  await core.group(`Running mise ${args.join(' ')}`, async () => {
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
  await core.group(`Writing ${p}`, async () => {
    core.info(`Body:\n${body}`)
    await fs.promises.writeFile(p, body, { encoding: 'utf8' })
  })

run()

function miseDir(): string {
  const dir = core.getState('MISE_DIR')
  if (dir) return dir

  const miseDir = core.getInput('mise_dir')
  if (miseDir) return miseDir

  const { MISE_DATA_DIR, XDG_DATA_HOME, LOCALAPPDATA } = process.env
  if (MISE_DATA_DIR) return MISE_DATA_DIR
  if (XDG_DATA_HOME) return path.join(XDG_DATA_HOME, 'mise')
  if (process.platform === 'win32' && LOCALAPPDATA)
    return path.join(LOCALAPPDATA, 'mise')

  return path.join(os.homedir(), '.local', 'share', 'mise')
}

async function saveCache(cacheKey: string): Promise<void> {
  await core.group(`Saving mise cache`, async () => {
    const cachePath = miseDir()

    if (!fs.existsSync(cachePath)) {
      throw new Error(`Cache folder path does not exist on disk: ${cachePath}`)
    }

    const cacheId = await cache.saveCache([cachePath], cacheKey)
    if (cacheId === -1) return

    core.info(`Cache saved from ${cachePath} with key: ${cacheKey}`)
  })
}

async function getTarget(): Promise<string> {
  let { arch } = process

  // quick overwrite to abide by release format
  if (arch === 'arm') arch = 'armv7' as NodeJS.Architecture

  switch (process.platform) {
    case 'darwin':
      return `macos-${arch}`
    case 'win32':
      return `windows-${arch}`
    case 'linux':
      return `linux-${arch}${(await isMusl()) ? '-musl' : ''}`
    default:
      throw new Error(`Unsupported platform ${process.platform}`)
  }
}

async function processCacheKeyTemplate(template: string): Promise<string> {
  // Get all available variables
  const version = core.getInput('version')
  const installArgs = core.getInput('install_args')
  const cacheKeyPrefix = core.getInput('cache_key_prefix') || 'mise-v0'
  const miseEnv = process.env.MISE_ENV?.replace(/,/g, '-')
  const platform = await getTarget()

  // Calculate file hash
  const fileHash = await glob.hashFiles(MISE_CONFIG_FILE_PATTERNS.join('\n'))

  // Calculate install args hash
  let installArgsHash = ''
  if (installArgs) {
    const tools = installArgs
      .split(' ')
      .filter(arg => !arg.startsWith('-'))
      .sort()
      .join(' ')
    if (tools) {
      installArgsHash = crypto.createHash('sha256').update(tools).digest('hex')
    }
  }

  // Prepare base template data
  const baseTemplateData = {
    version,
    cache_key_prefix: cacheKeyPrefix,
    platform,
    file_hash: fileHash,
    mise_env: miseEnv,
    install_args_hash: installArgsHash
  }

  // Calculate the default cache key by processing the default template
  const defaultTemplate = Handlebars.compile(DEFAULT_CACHE_KEY_TEMPLATE)
  const defaultCacheKey = defaultTemplate(baseTemplateData)

  // Prepare final template data including the default cache key and env variables
  const templateData = {
    ...baseTemplateData,
    default: defaultCacheKey,
    env: process.env
  }

  // Compile and execute the user's template
  const compiledTemplate = Handlebars.compile(template)
  return compiledTemplate(templateData)
}

async function isMusl() {
  // `ldd --version` always returns 1 and print to stderr
  const { stderr } = await exec.getExecOutput('ldd', ['--version'], {
    failOnStdErr: false,
    ignoreReturnCode: true
  })
  return stderr.indexOf('musl') > -1
}
