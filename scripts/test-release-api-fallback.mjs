// Run the packaged action with real GitHub API assets, injecting a 504 only
// for direct release URLs. The action's verification code runs unchanged.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { once } from 'node:events'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const version = '2026.10.7'
const exec = promisify(execFile)
const root = await mkdtemp(join(tmpdir(), 'mise-api-fallback-'))
const seen = new Set()
const server = createServer((request, response) => {
  seen.add(request.url.slice(1))
  response.writeHead(504).end('forced primary release download failure')
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
try {
  const bin = join(root, 'mock-bin')
  await mkdir(bin)
  const curl = (await exec('which', ['curl'])).stdout.trim()
  await writeFile(join(bin, 'curl'), `#!/usr/bin/env bash
set -euo pipefail
args=("$@")
last=$((\${#args[@]} - 1))
case "\${args[$last]}" in
  https://github.com/jdx/mise/releases/download/v${version}/*)
    args[$last]="http://127.0.0.1:${server.address().port}/\${args[$last]##*/}"
    ;;
esac
exec "\${REAL_CURL}" "\${args[@]}"
`)
  await chmod(join(bin, 'curl'), 0o755)
  const action = fileURLToPath(new URL('../dist/index.js', import.meta.url))
  const miseDir = join(root, 'mise')
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    REAL_CURL: curl,
    RUNNER_TEMP: root,
    GITHUB_WORKSPACE: root,
    INPUT_VERSION: version,
    INPUT_MISE_DIR: miseDir,
    INPUT_FETCH_FROM_GITHUB: 'true',
    INPUT_GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? ''
  }
  for (const input of ['CACHE', 'AUTO_UPDATE', 'RESHIM', 'INSTALL', 'ENV',
    'BOOTSTRAP', 'ADD_SHIMS_TO_PATH', 'WINGS_ENABLED', 'EXPERIMENTAL', 'EXPORT_PATH']) {
    env[`INPUT_${input}`] = 'false'
  }
  for (const command of ['PATH', 'ENV', 'OUTPUT', 'STATE']) {
    const file = join(root, `github-${command.toLowerCase()}`)
    await writeFile(file, '')
    env[`GITHUB_${command}`] = file
  }
  const run = async () => {
    seen.clear()
    try {
      return (await exec(process.execPath, [action], { cwd: root, env, timeout: 180_000 })).stdout
    } catch (error) {
      process.stderr.write(error.stdout ?? '')
      process.stderr.write(error.stderr ?? '')
      throw error
    }
  }
  const checksums = `SHASUMS256-${version}.txt`
  const cold = await run()
  assert.match(cold, /HTTP 504/)
  assert.match(cold, /Switching to the GitHub release assets API/)
  assert.match(cold, /against the signed packslip/)
  assert([...seen].some(asset => asset.startsWith(`mise-v${version}-`)))
  assert(seen.has('packslip.sigstore.json'))
  assert(seen.has('SHASUMS256.txt'))
  assert(seen.has('SHASUMS256.txt.minisig'))
  assert((await readFile(join(miseDir, 'bin', checksums))).length > 0)
  console.log('Fresh install: 504 on release archive and verification assets, signed packslip verified.')

  // Simulate a runner last used by v5.1.2, which retains only the executable.
  await rm(join(miseDir, 'bin', checksums))
  await rm(join(miseDir, 'bin', `${checksums}.minisig`))
  const warm = await run()
  assert.match(warm, /HTTP 504/)
  assert.match(warm, /Switching to the GitHub release assets API/)
  assert.match(warm, /against signed checksums/)
  assert.match(warm, /Verified existing mise@2026\.10\.7/)
  assert.deepEqual(seen, new Set(['SHASUMS256.txt', 'SHASUMS256.txt.minisig']))
  console.log('Warm install: 504 on checksum and signature, existing binary verified via the API.')

  const cached = await run()
  assert.match(cached, /Verified existing mise@2026\.10\.7/)
  assert.equal(seen.size, 0)
  console.log('Warm install with signed metadata: verified without requesting release assets.')
} finally {
  server.close()
  await rm(root, { recursive: true, force: true })
}
