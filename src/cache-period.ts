const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Number of whole `maxAgeDays` periods since the Unix epoch. Putting it in the
 * cache key makes the cache roll over at most every `maxAgeDays`, so a cache
 * that is hit often (and so never evicted by GitHub) still gets rebuilt with
 * the latest mise. Returns an empty string when `maxAgeDays` is 0.
 */
export function cachePeriod(maxAgeDays: number, now = Date.now()): string {
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 0) {
    throw new Error(
      `cache_max_age_days must be a non-negative integer, got: ${maxAgeDays}`
    )
  }
  if (maxAgeDays === 0) return ''
  return String(Math.floor(now / MS_PER_DAY / maxAgeDays))
}
