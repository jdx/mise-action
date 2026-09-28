type MiseRelease = {
  version: string
  publishedAt: number
}

/** Select the highest eligible mise calendar version from the published index. */
export function selectMiseRelease(
  index: string,
  cutoff: Date
): MiseRelease | undefined {
  if (!Number.isFinite(cutoff.getTime())) {
    throw new Error('Invalid minimum release age cutoff')
  }
  let selected: MiseRelease | undefined
  let selectedKey: number[] | undefined
  for (const line of index.split(/\r?\n/)) {
    if (!line.trim()) continue
    const match = /^v(\d+\.\d+\.\d+)\t(\d+)$/.exec(line)
    if (!match) throw new Error('Invalid mise release index row')
    const version = match[1]
    const key = version.split('.').map(Number)
    const publishedAt = Number(match[2])
    if (
      !key.every(Number.isSafeInteger) ||
      !Number.isSafeInteger(publishedAt) ||
      !Number.isFinite(new Date(publishedAt * 1000).getTime())
    ) {
      throw new Error('Invalid mise release index row')
    }
    if (publishedAt * 1000 > cutoff.getTime()) continue
    // This comparator is only for mise's numeric calendar versions, not tools.
    const previousKey = selectedKey
    const difference = previousKey
      ? key.map((part, i) => part - previousKey[i]).find(part => part !== 0) ||
        0
      : 1
    if (difference > 0) {
      selected = { version, publishedAt }
      selectedKey = key
    }
  }
  return selected
}
