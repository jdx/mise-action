import * as path from 'path'

/**
 * The data directory to use on a GitHub-hosted Windows runner whose workspace
 * is not on the system drive, or undefined to keep mise's default.
 *
 * Hosted Windows runners keep the workspace on D: and `%LOCALAPPDATA%` on C:.
 * Restoring the mise cache onto D: is several times faster than onto C:.
 */
export function workspaceDataDir(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string | undefined {
  if (platform !== 'win32') return undefined
  if (env.RUNNER_ENVIRONMENT !== 'github-hosted') return undefined
  if (env.MISE_DATA_DIR || env.XDG_DATA_HOME) return undefined
  const workspace = env.GITHUB_WORKSPACE
  if (!workspace) return undefined
  const root = path.win32.parse(workspace).root
  if (!root) return undefined
  const systemDrive = env.SYSTEMDRIVE
  if (systemDrive && root.toUpperCase().startsWith(systemDrive.toUpperCase())) {
    return undefined
  }
  return path.win32.join(root, 'mise')
}
