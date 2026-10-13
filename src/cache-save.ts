/**
 * Decide which key (if any) to save the mise cache under after a restore.
 *
 * A miss saves under the primary key. A prefix-matched restore (`restoredKey`
 * differs from `primaryKey`) also saves, so the exact key gets populated. An
 * exact hit already exists and needs no save.
 */
export function cacheKeyToSave(
  primaryKey: string,
  restoredKey: string | undefined
): string | undefined {
  return restoredKey === primaryKey ? undefined : primaryKey
}

/** Prefer action state, then the restore path retained in this process. */
export function cachePathToSave(
  statePath: string | undefined,
  processPath: string | undefined,
  fallbackPath: string
): string {
  return statePath || processPath || fallbackPath
}
