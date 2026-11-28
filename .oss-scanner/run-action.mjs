// Run the bundled action (dist/index.js) outside GitHub Actions, offline, against the mise this
// image installed at $MISE_DATA_DIR/bin/mise. Inputs default to action.yml; set INPUT_<NAME> to
// override one. GITHUB_ENV, GITHUB_PATH and the other runner files go to a fresh temp directory.
//   node .oss-scanner/run-action.mjs
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import * as yaml from 'js-yaml'

const src = path.resolve(import.meta.dirname, '..')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-action-run-'))
for (const name of ['ENV', 'PATH', 'OUTPUT', 'STATE']) {
  const file = path.join(work, name.toLowerCase())
  fs.writeFileSync(file, '')
  process.env[`GITHUB_${name}`] ??= file
}
fs.mkdirSync(path.join(work, 'tmp'))
process.env.RUNNER_TEMP ??= path.join(work, 'tmp')
process.env.GITHUB_WORKSPACE ??= src

// Point the action at the installed mise by version and checksum, so it verifies it without the
// network, and skip the cache and `mise install`, which need the network too.
const miseBin = path.join(process.env.MISE_DATA_DIR, 'bin', 'mise')
process.env.INPUT_VERSION ??= execFileSync(miseBin, ['--version']).toString().split(' ')[0]
process.env.INPUT_SHA256 ??= createHash('sha256').update(fs.readFileSync(miseBin)).digest('hex')
process.env.INPUT_CACHE ??= 'false'
process.env.INPUT_INSTALL ??= 'false'

const { inputs } = yaml.load(fs.readFileSync(path.join(src, 'action.yml'), 'utf8'))
for (const [key, spec] of Object.entries(inputs)) {
  const name = `INPUT_${key.replace(/ /g, '_').toUpperCase()}`
  const value = spec.default === undefined ? '' : String(spec.default)
  if (process.env[name] === undefined && !value.includes('${{')) process.env[name] = value
}

process.chdir(src)
await import(path.join(src, 'dist', 'index.js'))
process.on('exit', () => {
  console.log(`--- GITHUB_ENV\n${fs.readFileSync(process.env.GITHUB_ENV, 'utf8')}`)
  console.log(`--- GITHUB_PATH\n${fs.readFileSync(process.env.GITHUB_PATH, 'utf8')}`)
})
