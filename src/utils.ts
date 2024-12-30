import * as core from '@actions/core'
import * as os from 'os'
import * as path from 'path'
import { getOS } from './index'

export function miseDir(): string {
  const dir = core.getState('MISE_DIR')
  if (dir) return dir

  const { MISE_DATA_DIR, XDG_DATA_HOME, LOCALAPPDATA } = process.env
  if (MISE_DATA_DIR) return MISE_DATA_DIR
  if (XDG_DATA_HOME) return path.join(XDG_DATA_HOME, 'mise')
  if (getOS() === 'windows' && LOCALAPPDATA)
    return path.join(LOCALAPPDATA, 'mise')

  return path.join(os.homedir(), '.local', 'share', 'mise')
}
