import * as path from 'path'

function normalizePathEntry(entry: string): string {
  const normalized = path.normalize(entry)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** The entries of mise's computed PATH that later steps need ahead of currentPath. */
export function getMisePathAdditions(
  currentPath: string,
  computedPath: string
): string[] {
  const currentEntries = currentPath.split(path.delimiter).filter(Boolean)
  const computedEntries = computedPath.split(path.delimiter).filter(Boolean)
  const normalizedCurrent = currentEntries.map(normalizePathEntry)
  const normalizedComputed = computedEntries.map(normalizePathEntry)

  // mise prepends its tool and [env] _.path entries to the existing PATH.
  // Prefer the prefix before the unchanged current PATH so entries that mise
  // intentionally promotes retain their position.
  if (normalizedCurrent.length > 0) {
    for (
      let index = 0;
      index <= normalizedComputed.length - normalizedCurrent.length;
      index++
    ) {
      const currentPathStartsHere = normalizedCurrent.every(
        (entry, offset) => normalizedComputed[index + offset] === entry
      )
      if (currentPathStartsHere) return computedEntries.slice(0, index)
    }
  }

  // When mise promotes an entry that is already on PATH, such as a tool's bin
  // directory the runner image ships, it removes the entry from its old
  // position, so the current PATH no longer appears unchanged. The inherited
  // entries still keep their order, so treat everything before the longest
  // suffix that is a subsequence of the current PATH as mise's prefix. That
  // keeps promoted entries in it, ahead of the inherited ones.
  let prefixLength = normalizedComputed.length
  let searchEnd = normalizedCurrent.length
  while (prefixLength > 0 && searchEnd > 0) {
    const match = normalizedCurrent.lastIndexOf(
      normalizedComputed[prefixLength - 1],
      searchEnd - 1
    )
    if (match === -1) break
    searchEnd = match
    prefixLength--
  }
  return computedEntries.slice(0, prefixLength)
}
