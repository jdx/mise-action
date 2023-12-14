import * as core from '@actions/core'
import * as os from 'os'
import * as path from 'path'

export function rtxDir(): string {
  const dir = core.getState('RTX_DIR')
  if (dir) return dir

  const { RTX_DATA_DIR, XDG_DATA_HOME } = process.env
  if (RTX_DATA_DIR) return RTX_DATA_DIR
  if (XDG_DATA_HOME) return path.join(XDG_DATA_HOME, 'rtx')

  return path.join(os.homedir(), '.local/share/rtx')
}
