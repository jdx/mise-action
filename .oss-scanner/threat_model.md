# Threat model

## What this project does and where untrusted input enters

mise-action is a TypeScript GitHub Action (`src/`, bundled to `dist/index.js`, which is what runners
execute). It downloads and verifies the mise binary, restores and saves a GitHub Actions cache, runs
`mise install` or `mise bootstrap`, and exports mise's environment and PATH to later workflow steps
through `GITHUB_ENV` and `GITHUB_PATH`. Treat these as attacker-controlled:

- Network responses: the mise binary and archives from GitHub releases and the mise.jdx.dev CDN,
  `SHASUMS256.txt` and its `.minisig`, `packslip.sigstore.json`, and the `VERSION` and `releases.tsv`
  indexes used to pick a version (including `minimum_release_age` filtering).
- The GitHub Actions cache. Another workflow or branch in the same repository can write entries, so a
  restored mise binary, recorded version file, saved checksums or shims directory may be tampered with.
  The action must never run a cached binary before verifying it.
- Archive contents (tar.gz, tar.zst, and zip on Windows) and the filenames inside them.
- Output of `mise env --json`, `mise env --dotenv` and `mise env --paths`, since mise computes it from
  repository config. Values must not be able to inject extra lines into `GITHUB_ENV` or `GITHUB_PATH`.
- Entries already on `PATH`, including a shims directory restored from cache.

Trusted: the workflow author's inputs (`version`, `sha256`, `mise_toml`, `cache_key`, `install_args`,
`plugins` and the rest of `action.yml`), the repository checkout the workflow chose to run, and the
runner itself. The action trusts the checked-out config (`MISE_TRUSTED_CONFIG_PATHS`) by design, because
the workflow already runs that code.

## Components that matter most / least

Most: mise download and verification in `src/index.ts` (`setupMise`, `verifyDownloadedMiseAsset`,
`verifyExistingMiseAsset`, `verifyMinisign`, the CDN and GitHub fallbacks), `src/packslip.ts` (identity,
issuer, tag and downgrade rules), `src/shasums-cache.ts`, `src/release-index.ts`, cache restore and save,
archive extraction, `GITHUB_ENV`/`GITHUB_PATH` export and secret masking (`exportMiseEnv`,
`exportMiseDotenv`), and token handling in `src/github-token.ts` (the token must stay local to the action
unless `persist_github_token` is set, and must never reach logs, the cache or another host).
The action always runs mise by its verified absolute path, never through a PATH lookup (see
`scripts/mise-path.test.mjs`); a way to make it run another `mise` is a real bug.
Least: `scripts/` release helpers, `.github/` workflows, docs, and bundled third-party code in
`node_modules` unless the action reaches it with attacker-controlled input.

## How to exercise it

The image has the dependencies installed and `dist/index.js` rebuilt from `src/`. `aube test` runs the
unit tests in `scripts/*.test.mjs`, which import `src/*.ts` directly and inject the network, cache and
verifiers, so most of the verification logic can be driven offline. `aubr typecheck` checks the types.
A verified `mise` is at `/usr/local/bin/mise`. To run the action itself, set `INPUT_*` variables and
point `GITHUB_ENV`, `GITHUB_PATH`, `GITHUB_OUTPUT`, `HOME` and `RUNNER_TEMP` at a throwaway directory.

## How you rate severity

- Critical: running a mise binary, archive or cached file that did not pass verification; a bypass or
  downgrade of packslip, minisign or `sha256` verification that leads to code execution on the runner;
  writing outside the mise directory from a crafted archive.
- High: injecting variables or PATH entries into later steps through `GITHUB_ENV`/`GITHUB_PATH` from
  mise output or the cache; leaking `github_token` or another secret to logs, the cache, a later step that
  was not meant to get it, or a third-party host; a verification bypass without demonstrated execution.
  Rate by demonstrated impact, and the highest applicable level wins.
- Medium: denial of service from network or cache input (hangs, unbounded downloads or retries, a run
  that fails in a way the workflow cannot recover from), masking gaps for values mise marks as redacted.
- Low: hardening gaps with no demonstrated exploit.

## Anything to leave alone

- Workflow-author mistakes, such as interpolating untrusted `${{ github.event.* }}` text into inputs or
  running untrusted pull request code under `pull_request_target`.
- What mise or an installed tool does after the action installs it correctly; report those to mise.
- Reports that need a compromised runner, write access to the repository, or control of jdx/mise
  release signing.
- Behavior of mise releases that predate minisign checksums or packslips when the workflow pins one with
  `version`, beyond what the action documents.

Reports should include a runnable reproducer; a minimal patch is preferred over a large refactor.
