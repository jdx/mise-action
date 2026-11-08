/** A file attached to a GitHub release, named by a github.com download URL. */
export interface ReleaseAssetRef {
  owner: string
  repo: string
  tag: string
  name: string
}

/**
 * The release asset a `https://github.com/<owner>/<repo>/releases/download/<tag>/<name>`
 * URL names, or undefined for any other URL. github.com ignores credentials on
 * that path, so an authenticated download has to go through the REST API.
 */
export function parseReleaseDownloadUrl(
  url: string
): ReleaseAssetRef | undefined {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return undefined
  }
  if (u.protocol !== 'https:' || u.host !== 'github.com' || u.search) {
    return undefined
  }
  let parts: string[]
  try {
    parts = u.pathname.split('/').slice(1).map(decodeURIComponent)
  } catch {
    return undefined
  }
  if (parts.length !== 6 || parts[2] !== 'releases' || parts[3] !== 'download')
    return undefined
  const [owner, repo, , , tag, name] = parts
  if (!owner || !repo || !tag || !name) return undefined
  return { owner, repo, tag, name }
}

export function releaseByTagApiUrl(ref: ReleaseAssetRef): string {
  const [owner, repo, tag] = [ref.owner, ref.repo, ref.tag].map(
    encodeURIComponent
  )
  return `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`
}

/** The API URL that serves `name` from a `releases/tags/<tag>` response, if listed. */
export function assetApiUrl(
  releaseJson: string,
  name: string
): string | undefined {
  const release = JSON.parse(releaseJson) as {
    assets?: { name?: string; url?: string }[]
  }
  const url = release.assets?.find(a => a.name === name)?.url
  return url?.startsWith('https://api.github.com/') ? url : undefined
}

/** One HTTP GET with extra headers; writes to `filePath` when given, else returns the body. */
export type HeaderRequest = (
  url: string,
  headers: string[],
  filePath?: string
) => Promise<string | undefined>

/**
 * Download `ref` through the REST API with `token`. Returns null when the
 * release does not list the asset, so the caller can use the plain URL; any
 * request error is thrown for the same reason.
 */
export async function downloadReleaseAsset(
  ref: ReleaseAssetRef,
  token: string,
  request: HeaderRequest,
  filePath?: string
): Promise<string | undefined | null> {
  const auth = `Authorization: Bearer ${token}`
  const release = await request(releaseByTagApiUrl(ref), [
    auth,
    'Accept: application/vnd.github+json'
  ])
  const assetUrl = assetApiUrl(release ?? '{}', ref.name)
  if (!assetUrl) return null
  return request(assetUrl, [auth, 'Accept: application/octet-stream'], filePath)
}
