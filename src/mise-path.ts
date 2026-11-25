/**
 * The directories to add to PATH, in the order to add them. Each addition is
 * prepended, so the last one wins: the verified mise binary's directory goes
 * last, so `mise` resolves to it rather than to a `mise` in the shims
 * directory, which may be restored from the cache.
 */
export function misePathDirs(
  binDir: string,
  shimsDir: string,
  addShims: boolean
): string[] {
  return addShims ? [shimsDir, binDir] : [binDir]
}
