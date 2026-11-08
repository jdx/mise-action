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
  const parts = u.pathname.split('/').slice(1).map(decodeURIComponent)
  if (parts.length !== 6 || parts[2] !== 'releases' || parts[3] !== 'download')
    return undefined
  const [owner, repo, , , tag, name] = parts
  if (!owner || !repo || !tag || !name) return undefined
  return { owner, repo, tag, name }
}

export function releaseByTagApiUrl(ref: ReleaseAssetRef): string {
  const tag = encodeURIComponent(ref.tag)
  return `https://api.github.com/repos/${ref.owner}/${ref.repo}/releases/tags/${tag}`
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
