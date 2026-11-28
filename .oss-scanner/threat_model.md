# Threat model

## What this project does and where untrusted input enters

mise-action is a TypeScript GitHub Action (`src/`, bundled to `dist/index.js`, which is what runners
execute). It downloads and verifies the mise binary, restores and saves a GitHub Actions cache, runs
`mise install` or `mise bootstrap`, and exports mise's environment and PATH to later workflow steps
through `GITHUB_ENV` and `GITHUB_PATH`. Treat these as attacker-controlled:

- Network responses: the mise binary and archives from GitHub releases and the mise.jdx.dev CDN,
  `SHASUMS256.txt` and its `.minisig`, `packslip.sigstore.json`, and the `VERSION` and `releases.tsv`
  indexes used to pick a version (including `minimum_release_age` filtering).
- The mise binary and its saved checksums when restored from the GitHub Actions cache (see "Cache
  poisoning" below for what the action verifies and what it treats as trusted).
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

## Cache poisoning

The action restores one cache of the whole mise data directory (`mise_dir`), by exact key with no
`restore-keys`: the mise binary, its recorded version and saved signed checksums in `bin/`, plus the
installed tools and shims. A separate version-keyed cache holds only the binary and its checksums (with
`auto_update`, and for older caches with no version record). The two parts are treated differently.

In scope, the mise binary. A restored binary is never executed before it is checked against `sha256` or
the minisign-signed `SHASUMS256.txt` for its version, and a mismatch removes it and reinstalls (#637,
#641/#642). Saved checksums are re-verified against the minisign signature on every read, so a tampered
pair is ignored (#708). Every mise call runs that verified binary by absolute path, and the bin directory
comes ahead of the restored shims on PATH (#753). Report any way for cache contents to get the action to
run an unverified `mise`, to skip or weaken those checks (for example through the version record, a
pre-minisign or pre-packslip version, or the CDN fallback), or to make a cache written in one GitHub
cache scope restore in a job that GitHub would not otherwise let read it (for example through cache key
templating).

Out of scope, installed tools. Files under `installs/` and the shims a restored cache brings back are
trusted build input, as documented: mise does not check an installed tree against `mise.lock`, and the
README tells release workflows to set `cache: false` because a workflow that runs untrusted code with
write access to the default branch's cache scope (`pull_request_target`, `workflow_run`,
`issue_comment`) can plant files there (#682, #683; mise docs: continuous-integration.md "Cache
downloads, not installs" and mise-lock.md "Restored caches and installed tools"). An ordinary
`pull_request` build writes only to its own merge-ref scope, which other branches don't restore.
Workflows that need a cache they don't trust should cache mise's download store with a committed
`mise.lock`, which mise verifies, instead.
So a report that a poisoned cache changes an installed tool, or a shim that a later step runs, is not a
vulnerability unless it also gets past the binary checks above or crosses a cache scope.

## How to exercise it

The image has the dependencies installed and `dist/index.js` rebuilt from `src/`. `aube test` runs the
unit tests in `scripts/*.test.mjs`, which import `src/*.ts` directly and inject the network, cache and
verifiers, so most of the verification logic can be driven offline. `aubr typecheck` checks the types.
mise is installed at `$MISE_DATA_DIR/bin/mise` (`/opt/mise/bin/mise`), where the action looks for it.
`.oss-scanner/run-action.sh` runs the action through `.oss-scanner/workflow.yml` with jactionlint's local
runner (`jactionlint run`, https://jactionlint.jdx.dev/run), which plays the part of the Actions runner:
it fills in `action.yml`'s defaults and the workflow's `with:`, runs the main and post steps, applies
`GITHUB_ENV` and `GITHUB_PATH` to the next step, and serves the Actions cache API on 127.0.0.1, so it all
works without the internet. The script passes that binary's version and SHA-256 as `version` and
`sha256`, so the action verifies it without the network, and `install` and `cache` are off unless you ask.
`.oss-scanner/run-action.sh --net=none --no-cache` runs the action alone. `.oss-scanner/run-action.sh -i
cache=true` saves `$MISE_DATA_DIR` to the local cache service, and running it again restores it: change
the stored entry under `~/.cache/jactionlint/cache` (`jactionlint cache ls`) between the two runs to test
what the action does with a tampered cache. Edit `workflow.yml` to try other inputs, and pass any other
`jactionlint run` option (`--debug`, `--keep`) after the script's name. The local runner refuses some
`GITHUB_ENV` names that GitHub's runner accepts (`NODE_OPTIONS`, `LD_*`, `BASH_ENV` and others), so check
a `GITHUB_ENV` finding against GitHub's rules, not only against what happens here.

## How you rate severity

- Critical: running a mise binary, downloaded or restored from the cache, that did not pass verification;
  a bypass or downgrade of packslip, minisign or `sha256` verification that leads to code execution on
  the runner; writing outside the mise directory from a crafted archive.
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
- Tampered installed tools or shims from a restored cache, and restoring the cache in a release job,
  as described under "Cache poisoning".
- What mise or an installed tool does after the action installs it correctly; report those to mise.
- Reports that need a compromised runner, write access to the repository, or control of jdx/mise
  release signing.
- Behavior of mise releases that predate minisign checksums or packslips when the workflow pins one with
  `version`, beyond what the action documents.

Reports should include a runnable reproducer; a minimal patch is preferred over a large refactor.
