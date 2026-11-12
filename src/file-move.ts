import * as fs from 'fs'

/**
 * Directory to create scratch directories in. Prefer `RUNNER_TEMP`: on hosted
 * Windows x64 runners it is on the same drive as the workspace, while
 * `os.tmpdir()` is on `C:`, so a `MISE_DATA_DIR` inside the workspace would be
 * on another device than the download.
 */
export function tempRoot(
  env: NodeJS.ProcessEnv,
  fallback: string,
  exists: (dir: string) => boolean = fs.existsSync
): string {
  const runnerTemp = env.RUNNER_TEMP
  return runnerTemp && exists(runnerTemp) ? runnerTemp : fallback
}

interface MoveOps {
  mv: (src: string, dest: string) => Promise<void>
  copyFile: (src: string, dest: string) => Promise<void>
  unlink: (path: string) => Promise<void>
}

/**
 * Move a file, copying and deleting when a rename cannot cross devices
 * (`EXDEV`), such as the temp directory and the mise data directory being on
 * different drives.
 */
export async function moveFile(
  src: string,
  dest: string,
  ops: MoveOps
): Promise<void> {
  try {
    await ops.mv(src, dest)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await ops.copyFile(src, dest)
    await ops.unlink(src)
  }
}
