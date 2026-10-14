/**
 * The PATH entries mise manages, from the output of `mise env --paths`.
 * mise versions without the flag exit non-zero; those return undefined so the
 * caller derives the entries from the computed PATH instead.
 */
export function parseManagedPaths(
  exitCode: number,
  stdout: string
): string[] | undefined {
  if (exitCode !== 0) return undefined
  return stdout.split(/\r?\n/).filter(Boolean)
}

/** Prefer the entries mise reported; derive them only when it did not. */
export function selectPathAdditions(
  managedPaths: string[] | undefined,
  derive: () => string[]
): string[] {
  return managedPaths ?? derive()
}
