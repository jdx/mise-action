import fs from 'node:fs'
import path from 'node:path'

export function shasumsPaths(dir: string, version: string): [string, string] {
  const file = path.join(dir, `SHASUMS256-${version}.txt`)
  return [file, `${file}.minisig`]
}

/**
 * The signed checksums saved beside the mise binary by an earlier run, or
 * undefined when there are none or the signature no longer verifies. The
 * cache is untrusted, so the signature is checked again on every read.
 */
export function readCachedShasums(
  dir: string,
  version: string,
  verify: (shasums: string, minisig: string) => void
): string | undefined {
  const [shasumsPath, minisigPath] = shasumsPaths(dir, version)
  try {
    const shasums = fs.readFileSync(shasumsPath, 'utf8')
    verify(shasums, fs.readFileSync(minisigPath, 'utf8'))
    return shasums
  } catch {
    return undefined
  }
}

/** Save verified checksums so a warm cache can verify mise without the network. */
export function writeCachedShasums(
  dir: string,
  version: string,
  shasums: string,
  minisig: string
): void {
  const [shasumsPath, minisigPath] = shasumsPaths(dir, version)
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(shasumsPath, shasums)
    fs.writeFileSync(minisigPath, minisig)
  } catch {
    // Best effort: without the files the next run downloads them again.
  }
}
