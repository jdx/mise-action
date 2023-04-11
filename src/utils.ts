import * as os from 'os'
import * as path from 'path'

export function rtxDir(): string {
  if (process.env.RTX_DATA_HOME) {
    return process.env.RTX_DATA_HOME
  }
  if (process.env.XDG_DATA_HOME) {
    return path.join(process.env.XDG_DATA_HOME, 'rtx')
  }
  return path.join(os.homedir(), '.local/share/rtx')
}
