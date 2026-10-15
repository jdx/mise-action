/**
 * Verify a downloaded mise release asset against the signed packslip that
 * every mise release ships (`packslip.sigstore.json`).
 *
 * The verifier, digest check and bundle download are injected so the policy
 * (which identity and tag to require, when to fall back) is testable without
 * the network or sigstore.
 */
import type { ArtifactDigest, VerifiedStatement } from 'packslip'

export const PACKSLIP_ISSUER = 'https://token.actions.githubusercontent.com'
export const PACKSLIP_PROJECT = 'github.com/jdx/mise'

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
 * false when the release has no packslip (`fetchBundle` resolves undefined).
 * Any failure once a packslip exists throws; callers must not fall back.
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
