import * as cache from '@actions/cache'
import * as io from '@actions/io'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as glob from '@actions/glob'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

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
    const autoloadEnv = core.getBooleanInput("autoload-env")
    if (autoloadEnv) {
      const output = await getExecOutput("mise", ["env", "--dotenv"])
      fs.appendFileSync(process.env.GITHUB_ENV!, output.stdout)
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

  const githubToken = core.getInput('github_token')
  if (githubToken) {
    set('GITHUB_TOKEN', githubToken)
  } else {
    core.warning(
      'No GITHUB_TOKEN provided. You may hit GitHub API rate limits when installing tools from GitHub.'
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
  const version = core.getInput('version')
  const installArgs = core.getInput('install_args')
  const { MISE_ENV } = process.env
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
  let primaryKey = `${prefix}-${await getTarget()}-${fileHash}`
  if (version) {
    primaryKey = `${primaryKey}-${version}`
  }
  if (MISE_ENV) {
    primaryKey = `${primaryKey}-${MISE_ENV}`
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

function miseDir(): string {
  const dir = core.getState('MISE_DIR')
  if (dir) return dir

  const { MISE_DATA_DIR, XDG_DATA_HOME, LOCALAPPDATA } = process.env
  if (MISE_DATA_DIR) return MISE_DATA_DIR
  if (XDG_DATA_HOME) return path.join(XDG_DATA_HOME, 'mise')
  if (process.platform === 'win32' && LOCALAPPDATA)
    return path.join(LOCALAPPDATA, 'mise')

  return path.join(os.homedir(), '.local', 'share', 'mise')
}

async function saveCache(cacheKey: string): Promise<void> {
  core.group(`Saving mise cache`, async () => {
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

async function isMusl() {
  // `ldd --version` always returns 1 and print to stderr
  const { stderr } = await exec.getExecOutput('ldd', ['--version'], {
    failOnStdErr: false,
    ignoreReturnCode: true
  })
  return stderr.indexOf('musl') > -1
}
