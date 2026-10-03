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
