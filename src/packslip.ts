/**
 * Verify a downloaded mise release asset against the signed packslip that
 * mise releases ship (`packslip.sigstore.json`) from 2026.9.3 on.
 *
 * The verifier, digest check and bundle download are injected so the policy
 * (which identity and tag to require, when to fall back) is testable without
 * the network or sigstore.
 */
import type { ArtifactDigest, VerifiedStatement } from 'packslip'

export const PACKSLIP_ISSUER = 'https://token.actions.githubusercontent.com'
export const PACKSLIP_PROJECT = 'github.com/jdx/mise'

/** The first mise release that shipped `packslip.sigstore.json`. */
export const PACKSLIP_REQUIRED_FROM = [2026, 9, 3]

/**
 * Releases from `PACKSLIP_REQUIRED_FROM` on always ship a packslip. A version
 * that is not three dotted numbers is not a release this action can name, so
 * it is held to the same rule rather than skipped.
 */
export function packslipRequired(version: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!m) return true
  for (let i = 0; i < 3; i++) {
    const have = Number(m[i + 1])
    if (have !== PACKSLIP_REQUIRED_FROM[i]) {
      return have > PACKSLIP_REQUIRED_FROM[i]
    }
  }
  return true
}

export interface PackslipVerifier {
  verifyRelease(
    bundle: string,
    options: { identity: string; issuer: string; project: string; tag: string }
  ): Promise<VerifiedStatement>
  findArtifact(statement: VerifiedStatement, assetName: string): ArtifactDigest
  verifyFileDigest(path: string, artifact: ArtifactDigest): Promise<void>
}

export function packslipUrl(version: string): string {
  return `https://github.com/jdx/mise/releases/download/v${version}/packslip.sigstore.json`
}

export function packslipIdentity(version: string): string {
  return `https://github.com/jdx/mise/.github/workflows/release.yml@refs/tags/v${version}`
}

/**
 * Returns true once `filePath` is verified against the release's packslip, and
 * false when an older release has no packslip (`fetchBundle` resolves
 * undefined). A release from `PACKSLIP_REQUIRED_FROM` on must have one, so a
 * missing bundle there throws: it would otherwise let a tampered release
 * downgrade to the weaker checksum check. Any failure throws; callers must not
 * fall back.
 */
export async function verifyAgainstPackslip(
  filePath: string,
  version: string,
  assetName: string,
  fetchBundle: (url: string) => Promise<string | undefined>,
  verifier: PackslipVerifier
): Promise<boolean> {
  const bundle = await fetchBundle(packslipUrl(version))
  if (bundle === undefined) {
    if (packslipRequired(version)) {
      throw new Error(
        `mise v${version} must ship a signed packslip, but ${packslipUrl(version)} was not found`
      )
    }
    return false
  }
  const statement = await verifier.verifyRelease(bundle, {
    identity: packslipIdentity(version),
    issuer: PACKSLIP_ISSUER,
    project: PACKSLIP_PROJECT,
    tag: `v${version}`
  })
  await verifier.verifyFileDigest(
    filePath,
    verifier.findArtifact(statement, assetName)
  )
  return true
}
