/**
 * URLs a file from a mise release can be downloaded from, in the order they
 * should be tried.
 *
 * mise.jdx.dev mirrors each release under `v<version>/` with the same file
 * names as the GitHub release. Old releases are pruned from it, so the GitHub
 * release is always the last resort. `fetchFromGitHub` skips the mirror.
 */
export function miseReleaseUrls(
  version: string,
  fileName: string,
  fetchFromGitHub: boolean
): string[] {
  const githubUrl = `https://github.com/jdx/mise/releases/download/v${version}/${fileName}`
  if (fetchFromGitHub) {
    return [githubUrl]
  }
  return [`https://mise.jdx.dev/v${version}/${fileName}`, githubUrl]
}

/**
 * Download from the first source that works.
 *
 * Every source but the last is tried once without retries, so a missing file
 * (an HTTP 404 for a pruned release) or a network failure moves on to the next
 * source immediately. The last source is downloaded with retries.
 *
 * Only the download goes through the fallback. Callers verify the result
 * afterwards, so a checksum or signature mismatch fails instead of being
 * retried from another source.
 */
export async function downloadFromFirstAvailable<T>(
  sources: string[],
  download: (source: string, retry: boolean) => Promise<T>,
  onFallback: (failed: string, next: string, err: unknown) => void
): Promise<T> {
  if (sources.length === 0) {
    throw new Error('No download sources')
  }
  for (let i = 0; i < sources.length - 1; i++) {
    try {
      return await download(sources[i], false)
    } catch (err) {
      onFallback(sources[i], sources[i + 1], err)
    }
  }
  return download(sources[sources.length - 1], true)
}
