export const MINIMUM_VERIFIED_DOWNLOADS_VERSION = '2026.10.7'
export const MINIMUM_LOCKED_INSTALL_VERSION = '2025.11.11'

/** Parse `mise --version`, including the platform suffix on current releases. */
export function parseMiseVersion(output: string): string | undefined {
  const match = output.match(/(?:^|\s)v?(\d{4}\.\d+\.\d+)(?=\s|$)/)
  return match?.[1]
}

/** Return true only when a recognized mise release is at or above the minimum. */
export function supportsLockedInstall(versionOutput: string): boolean {
  return isAtLeast(versionOutput, MINIMUM_LOCKED_INSTALL_VERSION)
}

export function supportsVerifiedDownloads(versionOutput: string): boolean {
  return isAtLeast(versionOutput, MINIMUM_VERIFIED_DOWNLOADS_VERSION)
}

function isAtLeast(versionOutput: string, minimumVersion: string): boolean {
  const version = parseMiseVersion(versionOutput)
  if (!version) return false
  const actual = version.split('.').map(Number)
  const minimum = minimumVersion.split('.').map(Number)
  for (let i = 0; i < minimum.length; i++) {
    if (actual[i] !== minimum[i]) return actual[i] > minimum[i]
  }
  return true
}
