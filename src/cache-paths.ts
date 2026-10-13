import * as os from 'os'
import * as path from 'path'

/** Resolve mise's cache directory using the same environment precedence as mise. */
export function miseCacheDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir = os.homedir()
): string {
  if (env.MISE_CACHE_DIR) return env.MISE_CACHE_DIR
  if (env.XDG_CACHE_HOME) return path.join(env.XDG_CACHE_HOME, 'mise')
  if (platform === 'darwin')
    return path.join(homeDir, 'Library', 'Caches', 'mise')
  if (platform === 'win32') return path.join(env.TEMP || os.tmpdir(), 'mise')
  return path.join(homeDir, '.cache', 'mise')
}

/** Only the download CAS is safe/useful to restore; installed data is mutable. */
export function miseDownloadCacheDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir = os.homedir()
): string {
  return path.join(miseCacheDir(env, platform, homeDir), 'downloads-cas')
}

/** Per-run default data directory prevents trusting installed trees from prior runs. */
export function freshMiseDataDir(
  env: NodeJS.ProcessEnv = process.env,
  tempDir = env.RUNNER_TEMP || os.tmpdir()
): string {
  const runId = env.GITHUB_RUN_ID || `local-${process.pid}`
  const attempt = env.GITHUB_RUN_ATTEMPT || '1'
  return path.join(tempDir, 'mise-action-data', `${runId}-${attempt}`)
}

/** Verified-downloads must not reuse caller-selected installed tool trees. */
export function hasExplicitMiseDataDir(
  miseDirInput: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return Boolean(miseDirInput || env.MISE_DATA_DIR)
}

/** Recognize the false values accepted by mise's boolean environment settings. */
export function isDownloadCacheDisabled(value: string | undefined): boolean {
  return value !== undefined && /^(?:0|false|no|off)$/i.test(value.trim())
}
