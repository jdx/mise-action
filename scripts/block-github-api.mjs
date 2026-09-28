// Catch a regression to the previous fetch-based release-history lookup.
const originalFetch = globalThis.fetch

globalThis.fetch = (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input)
  if (url.hostname === 'api.github.com') {
    throw new Error(`Release selection must not call the GitHub API: ${url}`)
  }
  return originalFetch(input, options)
}
