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
  '{{cache_key_prefix}}-{{platform}}{{#if version}}-{{version}}{{/if}}{{#if mise_env}}-{{mise_env}}{{/if}}{{#if install_args_hash}}-{{install_args_hash}}{{/if}}{{#if bootstrap_hash}}-{{bootstrap_hash}}{{/if}}-{{#if file_hash}}{{file_hash}}{{else}}no-config{{/if}}'

const ROOT_MISE_LOCK_FILE_PATTERNS = [/^\.?mise(?:\.[^.]+)?\.lock$/]
const CONFIG_DIR_MISE_LOCK_FILE_PATTERNS = [/^mise(?:\.[^.]+)?\.lock$/]
const CONFIG_MISE_LOCK_FILE_PATTERNS = [/^config(?:\.[^.]+)?\.lock$/]
const MISE_MINISIGN_PUBLIC_KEY =
  'RWTC3g8W3z4RZK3V3qv7fa1QY4JEWyBtqIHW+85QlJpZc5yG+uNYNBSZ'
const MISE_MINISIGN_STARTED_AT = { year: 2024, month: 12, patch: 24 }
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const verifiedShasums = new Map<string, string>()

type DownloadTool = 'curl' | 'wget'
let cachedDownloadTool: DownloadTool | undefined

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

    // Wings opt-in hook (experimental). When
    // `wings_enabled: true` is set, this exports
    // `MISE_WINGS_ENABLED=1` so subsequent `mise install`
    // commands in this workflow route through the wings
    // cache. Default `false` so workflows with
    // `id-token: write` (used for SLSA / AWS-OIDC / Sigstore /
    // etc.) don't silently send the runner's OIDC token to
    // a third-party cache without explicit consent.
    //
    // Note: `setupMise` fetches the mise binary itself with
    // `curl` or `wget`, which doesn't go through mise's HTTP layer —
    // the wings rewriter only kicks in once the resulting
    // mise binary runs `mise install` and friends. Ordering
    // here is irrelevant for binary acceleration; we just
    // want the env var set before any `mise` subcommand
    // runs. Greptile + Gemini both flagged the previous
    // comment as overstating what the early call accelerates.
    setupWings()

    const version = core.getInput('version')
    const fetchFromGitHub = core.getBooleanInput('fetch_from_github')
    await setupMise(version, fetchFromGitHub)
    await setEnvVars()
    if (core.getBooleanInput('reshim')) {
      await miseReshim()
    }
    await testMise()
    if (core.getBooleanInput('install')) {
      if (core.getBooleanInput('bootstrap')) {
        await miseBootstrap()
      } else {
        await miseInstall()
      }
      if (cacheKey && core.getBooleanInput('cache_save'))
        await saveCache(cacheKey)
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

/**
 * Opt in to mise-wings caching for this workflow run. When
 * `wings_enabled: true`, exports `MISE_WINGS_ENABLED=1` so
 * subsequent `mise install` commands route through the
 * cache.
 *
 * Mise itself owns the OIDC → wings session exchange — when
 * it sees `MISE_WINGS_ENABLED=1` and the GHA OIDC env vars
 * (`ACTIONS_ID_TOKEN_REQUEST_URL` +
 * `ACTIONS_ID_TOKEN_REQUEST_TOKEN`), it fetches the runner's
 * OIDC token, exchanges it at the proxy's `POST /auth`
 * route, and caches the resulting session JWT for the rest
 * of the process.
 *
 * Pre-flight check: `id-token: write` permission must be
 * declared at the workflow or job level for the OIDC env
 * vars to be present. We log a warning when wings is
 * enabled but the env vars are absent — without this hint,
 * the user sees a transparent "wings configured but doing
 * nothing" which is hard to debug.
 */
function setupWings(): void {
  if (!core.getBooleanInput('wings_enabled')) {
    return
  }
  core.exportVariable('MISE_WINGS_ENABLED', '1')
  core.info(
    "mise-wings: enabled. mise will exchange the runner's OIDC token for a wings session on first use."
  )

  const oidcUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
  const oidcToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (!oidcUrl || !oidcToken) {
    core.warning(
      'mise-wings: GHA OIDC env vars are missing. Add ' +
        '`permissions: id-token: write` at the workflow or job ' +
        'level so the runner can mint OIDC tokens. Without this, ' +
        'mise falls through to direct-origin fetches and the cache ' +
        'is bypassed.'
    )
  }
}

async function exportMiseEnv(): Promise<void> {
  core.startGroup('Exporting mise environment variables')

  const cwd = getCwd()

  // Check if mise supports --redacted flags based on version input
  const supportsRedacted = checkMiseSupportsRedacted()

  if (supportsRedacted) {
    try {
      // First, get the redacted values to identify what needs masking
      const redactedOutput = await exec.getExecOutput(
        'mise',
        ['env', '--redacted', '--json'],
        { silent: true, cwd }
      )
      const redactedVars = JSON.parse(redactedOutput.stdout)

      // Mask sensitive values in GitHub Actions
      for (const [key, actualValue] of Object.entries(redactedVars)) {
        core.setSecret(actualValue as string)
        core.info(`Masked sensitive value for: ${key}`)
      }

      // Then get the actual values
      const actualOutput = await exec.getExecOutput('mise', ['env', '--json'], {
        cwd
      })
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
      const output = await exec.getExecOutput('mise', ['env', '--dotenv'], {
        cwd
      })
      fs.appendFileSync(process.env.GITHUB_ENV!, output.stdout)
    }
  } else {
    // Fall back to the old --dotenv format for older versions
    const output = await exec.getExecOutput('mise', ['env', '--dotenv'], {
      cwd
    })
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
  if (
    core.getBooleanInput('experimental') ||
    core.getBooleanInput('bootstrap')
  ) {
    set('MISE_EXPERIMENTAL', '1')
  }

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

  if (core.getBooleanInput('add_shims_to_path')) {
    const shimsDir = path.join(miseDir(), 'shims')
    core.info(`Adding ${shimsDir} to PATH`)
    core.addPath(shimsDir)
  }
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
  const miseShimPath = path.join(miseBinDir, 'mise-shim.exe')
  let installedVersion: string | undefined
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
    const target = await getTarget()
    const assetName = `mise-v${resolvedVersion}-${target}${ext}`
    const rawAssetName = `mise-v${resolvedVersion}-${target}${
      process.platform === 'win32' ? '.exe' : ''
    }`
    const fetchFromCdn = !fetchFromGitHub && !version
    const githubUrl = `https://github.com/jdx/mise/releases/download/v${resolvedVersion}/${assetName}`
    const cdnUrl = `https://mise.jdx.dev/mise-latest-${target}${
      process.platform === 'win32' ? '.exe' : ''
    }`
    installedVersion = resolvedVersion
    const installFromUrl = async (
      downloadUrl: string,
      downloadAssetName: string,
      checksumAssetName: string,
      extractArchive: boolean
    ): Promise<void> => {
      await withDownloadedMiseAsset(
        downloadUrl,
        resolvedVersion,
        downloadAssetName,
        checksumAssetName,
        async (downloadPath, tempDir) => {
          if (!extractArchive) {
            await io.mv(downloadPath, miseBinPath)
            await exec.exec('chmod', ['+x', miseBinPath])
            return
          }
          switch (ext) {
            case '.zip':
              await withExtractedZip(
                downloadPath,
                tempDir,
                async extractDir => {
                  const extractedMiseBinDir = path.join(
                    extractDir,
                    'mise',
                    'bin'
                  )
                  await io.mv(
                    path.join(extractedMiseBinDir, 'mise.exe'),
                    miseBinPath
                  )
                  await installWindowsMiseShim(
                    extractedMiseBinDir,
                    miseShimPath
                  )
                }
              )
              break
            case '.tar.zst':
              await installFromTarFile(
                downloadPath,
                ['--zstd', '-xf'],
                tempDir,
                miseBinPath
              )
              break
            case '.tar.gz':
              await installFromTarFile(
                downloadPath,
                ['-xzf'],
                tempDir,
                miseBinPath
              )
              break
            default:
              await io.mv(downloadPath, miseBinPath)
              await exec.exec('chmod', ['+x', miseBinPath])
              break
          }
        }
      )
    }
    try {
      if (fetchFromCdn) {
        await installFromUrl(cdnUrl, rawAssetName, rawAssetName, false)
      } else {
        await installFromUrl(githubUrl, assetName, assetName, true)
      }
    } catch (err) {
      if (!fetchFromCdn) {
        throw err
      }
      core.warning(
        `Could not verify mise from the CDN: ${errorMessage(err)}. Falling back to the verified GitHub release asset.`
      )
      await installFromUrl(githubUrl, assetName, assetName, true)
    }
  } else {
    const requestedVersion = cleanVersion(core.getInput('version'))
    if (requestedVersion !== '') {
      installedVersion = await getInstalledMiseVersion(miseBinPath)
      if (requestedVersion === installedVersion) {
        core.info(`mise already installed`)
      } else {
        core.info(
          `mise already installed (${installedVersion}), but different version requested (${requestedVersion})`
        )
        await exec.exec(miseBinPath, ['self-update', requestedVersion, '-y'])
        core.info(`mise updated to version ${requestedVersion}`)
        installedVersion = requestedVersion
      }
    }
  }
  await ensureWindowsMiseShim(miseBinPath, miseShimPath, installedVersion)
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

async function withExtractedZip(
  archivePath: string,
  tempDir: string,
  fn: (extractDir: string) => Promise<void>
): Promise<void> {
  const extractDir = path.join(tempDir, 'extract')
  await exec.exec('unzip', [archivePath, '-d', extractDir])
  await fn(extractDir)
}

async function installWindowsMiseShim(
  extractedMiseBinDir: string,
  miseShimPath: string
): Promise<void> {
  if (process.platform !== 'win32') return

  const extractedMiseShimPath = path.join(extractedMiseBinDir, 'mise-shim.exe')
  if (!fs.existsSync(extractedMiseShimPath)) {
    core.info('mise-shim.exe not found in the mise archive; skipping')
    return
  }

  await io.mv(extractedMiseShimPath, miseShimPath)
}

async function ensureWindowsMiseShim(
  miseBinPath: string,
  miseShimPath: string,
  version?: string
): Promise<void> {
  if (process.platform !== 'win32') return
  if (fs.existsSync(miseShimPath)) return

  core.info(
    'mise-shim.exe not found next to mise.exe; installing it from the matching release archive'
  )

  try {
    const installedVersion =
      version || (await getInstalledMiseVersion(miseBinPath))
    const archiveName = `mise-v${installedVersion}-${await getTarget()}.zip`
    const url = `https://github.com/jdx/mise/releases/download/v${installedVersion}/${archiveName}`

    await withDownloadedMiseAsset(
      url,
      installedVersion,
      archiveName,
      archiveName,
      async (downloadPath, tempDir) => {
        await withExtractedZip(downloadPath, tempDir, async extractDir => {
          await installWindowsMiseShim(
            path.join(extractDir, 'mise', 'bin'),
            miseShimPath
          )
        })
      }
    )
  } catch (err) {
    core.warning(
      `Failed to install mise-shim.exe: ${errorMessage(err)}. Continuing because mise can fall back to file shim mode on Windows.`
    )
  }
}

async function getDownloadTool(): Promise<DownloadTool> {
  if (cachedDownloadTool) return cachedDownloadTool
  if (await io.which('curl')) {
    cachedDownloadTool = 'curl'
  } else if (await io.which('wget')) {
    cachedDownloadTool = 'wget'
  } else {
    throw new Error('Neither curl nor wget is available to download mise')
  }
  core.info(`Using ${cachedDownloadTool} to download mise`)
  return cachedDownloadTool
}

async function downloadToFile(url: string, filePath: string): Promise<void> {
  const tool = await getDownloadTool()
  if (tool === 'curl') {
    await exec.exec('curl', ['-fsSL', url, '--output', filePath])
  } else {
    await exec.exec('wget', ['-qO', filePath, url])
  }
}

async function downloadText(url: string): Promise<string> {
  return (await downloadRawText(url)).trim()
}

async function downloadRawText(url: string): Promise<string> {
  const tool = await getDownloadTool()
  if (tool === 'curl') {
    const rsp = await exec.getExecOutput('curl', ['-fsSL', url], {
      silent: true
    })
    return rsp.stdout
  }
  const rsp = await exec.getExecOutput('wget', ['-qO-', url], {
    silent: true
  })
  return rsp.stdout
}

async function withDownloadedMiseAsset(
  url: string,
  version: string,
  assetName: string,
  verifyAssetName: string | undefined,
  fn: (downloadPath: string, tempDir: string) => Promise<void>
): Promise<void> {
  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'mise-action-')
  )
  try {
    const downloadPath = path.join(tempDir, assetName)
    await downloadToFile(url, downloadPath)
    if (verifyAssetName) {
      await verifyDownloadedMiseAsset(downloadPath, version, verifyAssetName)
    }
    await fn(downloadPath, tempDir)
  } finally {
    await io.rmRF(tempDir)
  }
}

async function verifyDownloadedMiseAsset(
  filePath: string,
  version: string,
  assetName: string
): Promise<void> {
  if (core.getInput('sha256')) {
    return
  }

  const shasums = await verifiedMiseShasums(version)
  if (!shasums) {
    return
  }
  const want = checksumForAsset(shasums, assetName)
  const got = await sha256File(filePath)
  if (got !== want) {
    throw new Error(
      `SHA256 mismatch: expected ${want}, got ${got} for ${assetName}`
    )
  }
  core.info(`Verified ${assetName} against signed checksums`)
}

async function verifiedMiseShasums(
  version: string
): Promise<string | undefined> {
  const cached = verifiedShasums.get(version)
  if (cached) {
    return cached
  }

  try {
    const shasumsUrl = `https://github.com/jdx/mise/releases/download/v${version}/SHASUMS256.txt`
    const minisigUrl = `${shasumsUrl}.minisig`
    const shasums = await downloadRawText(shasumsUrl)
    const minisig = await downloadRawText(minisigUrl)
    verifyMinisign(shasums, minisig)
    verifiedShasums.set(version, shasums)
    return shasums
  } catch (err) {
    if (miseReleasePredatesMinisign(version)) {
      core.warning(
        `Could not verify signed checksums for mise ${version}: ${errorMessage(err)}. Continuing because this pinned version predates mise minisign checksums.`
      )
      return undefined
    }
    throw err
  }
}

function checksumForAsset(shasums: string, assetName: string): string {
  for (const line of shasums.split(/\r?\n/)) {
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/)
    if (match && path.basename(match[2]) === assetName) {
      return match[1].toLowerCase()
    }
  }
  throw new Error(`No checksum found for ${assetName}`)
}

function verifyMinisign(data: string, minisig: string): void {
  const lines = minisig.trimEnd().split(/\r?\n/)
  if (lines.length < 4) {
    throw new Error('Invalid minisign signature')
  }

  const publicKeyBytes = Buffer.from(MISE_MINISIGN_PUBLIC_KEY, 'base64')
  const signatureBytes = Buffer.from(lines[1], 'base64')
  const trustedSignatureBytes = Buffer.from(lines[3], 'base64')
  if (
    publicKeyBytes.length !== 42 ||
    signatureBytes.length !== 74 ||
    trustedSignatureBytes.length !== 64
  ) {
    throw new Error('Invalid minisign signature format')
  }
  if (!publicKeyBytes.subarray(2, 10).equals(signatureBytes.subarray(2, 10))) {
    throw new Error('Minisign key id mismatch')
  }

  const publicKey = crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, publicKeyBytes.subarray(10)]),
    format: 'der',
    type: 'spki'
  })
  const dataDigest = crypto.createHash('blake2b512').update(data).digest()
  const dataSignature = signatureBytes.subarray(10)
  if (!crypto.verify(null, dataDigest, publicKey, dataSignature)) {
    throw new Error('Invalid SHASUMS256.txt minisign signature')
  }

  const trustedComment = lines[2].replace(/^trusted comment: /, '')
  const trustedCommentData = Buffer.concat([
    dataSignature,
    Buffer.from(trustedComment)
  ])
  if (
    !crypto.verify(null, trustedCommentData, publicKey, trustedSignatureBytes)
  ) {
    throw new Error('Invalid minisign trusted comment signature')
  }
}

function miseReleasePredatesMinisign(version: string): boolean {
  const match = cleanVersion(version).match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})/)
  if (!match) {
    return false
  }
  const [, year, month, patch] = match.map(Number)
  if (year !== MISE_MINISIGN_STARTED_AT.year) {
    return year < MISE_MINISIGN_STARTED_AT.year
  }
  if (month !== MISE_MINISIGN_STARTED_AT.month) {
    return month < MISE_MINISIGN_STARTED_AT.month
  }
  return patch < MISE_MINISIGN_STARTED_AT.patch
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  const fileBuffer = await fs.promises.readFile(filePath)
  return hash.update(fileBuffer).digest('hex')
}

async function installFromTarFile(
  archivePath: string,
  tarArgs: string[],
  tempDir: string,
  miseBinPath: string
): Promise<void> {
  await exec.exec('tar', [...tarArgs, archivePath, '-C', tempDir])
  const extractedMisePath = path.join(tempDir, 'mise', 'bin', 'mise')
  await exec.exec('mv', [extractedMisePath, miseBinPath])
}

async function getInstalledMiseVersion(miseBinPath: string): Promise<string> {
  const versionOutput = await exec.getExecOutput(
    miseBinPath,
    ['version', '--json'],
    { silent: true }
  )
  const versionJson = JSON.parse(versionOutput.stdout) as { version: string }
  return cleanVersion(versionJson.version.split(' ')[0])
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
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
  return downloadText('https://mise.jdx.dev/VERSION')
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
let supportsLockedInstall: boolean | undefined

const miseInstall = async (): Promise<number> => {
  const installArgs = core.getInput('install_args').trim()
  const useLocked =
    (await shouldUseLockedInstall()) &&
    !/(^|\s)--locked(?:\s|$)/.test(installArgs)
  const command = [
    'install',
    ...(useLocked ? ['--locked'] : []),
    ...(installArgs ? [installArgs] : [])
  ].join(' ')

  if (useLocked) {
    core.info('Detected a mise lock file, running `mise install --locked`')
  }

  return mise([command])
}
const miseBootstrap = async (): Promise<number> => {
  const installArgs = core.getInput('install_args').trim()
  if (installArgs) {
    throw new Error(
      '`install_args` cannot be used when `bootstrap` is true because `mise bootstrap` does not support partial tool install args.'
    )
  }

  const bootstrapSkip = core.getInput('bootstrap_skip').trim()
  const bootstrapArgs = core.getInput('bootstrap_args').trim()
  const useLocked =
    (await shouldUseLockedInstall()) &&
    !/(^|\s)--locked(?:\s|$)/.test(bootstrapArgs)
  const command = [
    ...(useLocked ? ['--locked'] : []),
    'bootstrap',
    ...(bootstrapSkip ? ['--skip', bootstrapSkip] : []),
    ...(bootstrapArgs ? [bootstrapArgs] : [])
  ].join(' ')

  if (useLocked) {
    core.info('Detected a mise lock file, running `mise --locked bootstrap`')
  }

  return mise([command])
}
const miseLs = async (): Promise<number> => mise([`ls`])
const miseReshim = async (): Promise<number> => mise([`reshim`, `-f`])
const mise = async (args: string[]): Promise<number> =>
  await core.group(`Running mise ${args.join(' ')}`, async () => {
    const cwd = getCwd()
    const baseEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined
      )
    )
    const env = core.isDebug()
      ? { ...baseEnv, MISE_LOG_LEVEL: 'debug' }
      : baseEnv

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

function getCwd(): string {
  return (
    core.getInput('working_directory') ||
    core.getInput('install_dir') ||
    process.cwd()
  )
}

async function shouldUseLockedInstall(): Promise<boolean> {
  if (core.getInput('tool_versions') || core.getInput('mise_toml')) return false
  if (!(await miseSupportsLockedInstall())) return false
  return hasMiseLockFile(getCwd())
}

async function miseSupportsLockedInstall(): Promise<boolean> {
  if (supportsLockedInstall !== undefined) return supportsLockedInstall

  const { stdout, stderr } = await exec.getExecOutput(
    'mise',
    ['install', '--help'],
    {
      cwd: getCwd(),
      ignoreReturnCode: true,
      silent: true
    }
  )

  supportsLockedInstall = /(^|\s)--locked(?:[\s,]|$)/m.test(
    `${stdout}\n${stderr}`
  )
  return supportsLockedInstall
}

function hasMiseLockFile(startDir: string): boolean {
  let dir = path.resolve(startDir)

  while (true) {
    if (directoryHasMiseLockFile(dir)) return true

    const parent = path.dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

function directoryHasMiseLockFile(dir: string): boolean {
  return (
    hasMatchingLockFile(dir, ROOT_MISE_LOCK_FILE_PATTERNS) ||
    hasMatchingLockFile(
      path.join(dir, '.config'),
      CONFIG_DIR_MISE_LOCK_FILE_PATTERNS
    ) ||
    hasMatchingLockFile(path.join(dir, '.config', 'mise'), [
      ...ROOT_MISE_LOCK_FILE_PATTERNS,
      ...CONFIG_MISE_LOCK_FILE_PATTERNS
    ]) ||
    hasMatchingLockFile(path.join(dir, '.mise'), [
      ...ROOT_MISE_LOCK_FILE_PATTERNS,
      ...CONFIG_MISE_LOCK_FILE_PATTERNS
    ]) ||
    hasMatchingLockFile(path.join(dir, 'mise'), [
      ...ROOT_MISE_LOCK_FILE_PATTERNS,
      ...CONFIG_MISE_LOCK_FILE_PATTERNS
    ])
  )
}

function hasMatchingLockFile(dir: string, patterns: RegExp[]): boolean {
  try {
    const stat = fs.statSync(dir, { throwIfNoEntry: false })
    if (!stat?.isDirectory()) return false

    return fs
      .readdirSync(dir, { withFileTypes: true })
      .some(
        entry =>
          entry.isFile() && patterns.some(pattern => pattern.test(entry.name))
      )
  } catch {
    return false
  }
}

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
  const arch = process.arch === 'arm' ? 'armv7' : process.arch
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

/**
 * Identifies the runner image so cached binaries from one provider
 * (github-hosted, namespace.so, BuildJet, self-hosted) aren't restored
 * onto another provider's image where their compiled-in paths and libc
 * versions don't match. GitHub-hosted images export `ImageOS`
 * (e.g. "macos15", "ubuntu24"); other runners leave it unset and pool
 * under "self-hosted".
 */
function getRunnerImageId(): string {
  return process.env.ImageOS || 'self-hosted'
}

async function processCacheKeyTemplate(template: string): Promise<string> {
  // Get all available variables
  const version = core.getInput('version')
  const installArgs = core.getInput('install_args')
  const bootstrap = core.getBooleanInput('bootstrap')
  const bootstrapSkip = core.getInput('bootstrap_skip')
  const bootstrapArgs = core.getInput('bootstrap_args')
  const cacheKeyPrefix = core.getInput('cache_key_prefix') || 'mise-v1'
  const miseEnv = process.env.MISE_ENV?.replace(/,/g, '-')
  const platform = `${await getTarget()}-${getRunnerImageId()}`

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

  let bootstrapHash = ''
  if (bootstrap) {
    bootstrapHash = crypto
      .createHash('sha256')
      .update([String(bootstrap), bootstrapSkip, bootstrapArgs].join('\0'))
      .digest('hex')
  }

  // Prepare base template data
  const baseTemplateData = {
    version,
    cache_key_prefix: cacheKeyPrefix,
    platform,
    file_hash: fileHash,
    mise_env: miseEnv,
    install_args_hash: installArgsHash,
    bootstrap_hash: bootstrapHash
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
