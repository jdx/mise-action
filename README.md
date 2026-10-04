# Example Workflow

```yaml
name: test
on:
  pull_request:
    branches:
      - main
  push:
    branches:
      - main
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: jdx/mise-action@v4
        with:
          version: 2026.3.10 # [default: newest release at least 24h old] mise version to install
          # minimum_release_age: 7d # default: 24h; use 0s to disable the delay
          install: true # [default: true] run `mise install`
          install_args: "bun" # [default: ""] additional arguments to `mise install`
          bootstrap: false # [default: false] run `mise bootstrap` instead of `mise install`
          bootstrap_skip: "tools,task" # [default: ""] comma-separated parts to skip when bootstrapping
          bootstrap_args: "--yes" # [default: ""] additional arguments to `mise bootstrap`
          cache: true # [default: true] cache mise using GitHub's cache
          cache_save_post: false # [default: false] save the cache in the post step, after later steps install more tools
          experimental: true # [default: false] enable experimental features
          log_level: debug # [default: info] log level
          # automatically write this .tool-versions file
          tool_versions: |
            shellcheck 0.11.0
          # or, if you prefer .mise.toml format:
          mise_toml: |
            [tools]
            shellcheck = "0.11.0"
          working_directory: app # [default: .] directory to run mise in
          reshim: false # [default: false] run `mise reshim -f`
          env: true # [default: true] export mise environment variables
          export_path: true # [default: true] add mise PATH entries to subsequent steps
          github_token: ${{ secrets.GITHUB_TOKEN }} # [default: ${{ github.token }}] GitHub token for API authentication
      - run: shellcheck scripts/*.sh
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: jdx/mise-action@v4
      # .tool-versions will be read from repo root
      - run: node ./my_app.js
```

## Cached mise and `auto_update`

With `version` unset, a mise binary restored from the cache is kept (after
verifying it against the signed checksums for its own version) until the cache
key changes, so mise may lag the latest release. To always reinstall when a
newer release is available, set `auto_update: true`. The updated binary is cached
separately by version, so mise is downloaded once per release rather than on every
run. Pinning `version` remains the way to upgrade deliberately.

## Minimum Release Age

By default, the action installs the newest stable mise release that is at least
24 hours old. To change the delay, set `minimum_release_age` and omit `version`:

```yaml
- uses: jdx/mise-action@v4
  with:
    minimum_release_age: 7d
```

Relative durations such as `24h`, `7d`, `6mo`, and `1y` are supported, as are
absolute ISO dates and timestamps. The action selects the newest stable,
non-draft mise release published before the cutoff. An explicit `version`
takes precedence over `minimum_release_age` and can install a release immediately.
Set `minimum_release_age: 0s` to select the latest stable release without a delay.
Release selection reads the public CDN release index and does not consume GitHub
API quota. If the index is unavailable
or invalid, the action fails rather than bypassing the age policy.
This input controls the mise binary; it does not set the release-age policy for
tools installed by mise.

## Environment and PATH Export

The action exports environment variables and PATH entries configured by mise
to subsequent workflow steps. PATH entries are added individually through
`GITHUB_PATH`, so the runner's complete PATH is not copied into `GITHUB_ENV`.
Set `export_path: false` to export regular environment variables without
persisting mise's PATH changes.

## Outputs

- `cache-hit`: `true` if the mise cache was restored.
- `versions`: JSON of the active, installed tools. Each tool maps to a list of `{version, requested_version, install_path, source}`.
- One output per tool with its resolved version (for example `steps.mise.outputs.bun`), for tools whose name is a valid output name. Tools like `npm:@scope/pkg` are only in `versions`.

This avoids a separate `mise ls --json | jq` step, for example to key another cache on the resolved version:

```yaml
- uses: jdx/mise-action@v5
  id: mise
- uses: actions/cache@v5
  with:
    path: ~/.bun/install/cache
    key: bun-${{ runner.os }}-${{ steps.mise.outputs.bun }}-${{ hashFiles('**/bun.lock') }}
```

If a tool has several active versions, the per-tool output is the first one; use `fromJSON(steps.mise.outputs.versions).node[1].version` for the others.

## Plugins

Some tools and idiomatic version files (such as `.yvmrc`) need a plugin. List them in the `plugins` input, one per line as `name` or `name url`, and the action installs them before running `mise install`:

```yaml
- uses: jdx/mise-action@v5
  env:
    # Idiomatic version files are opt-in per tool; this is needed for `.yvmrc`
    MISE_IDIOMATIC_VERSION_FILE_ENABLE_TOOLS: yarn
  with:
    plugins: |
      yarn
      php https://github.com/verzly/mise-php#latest
```

Plugins already present (for example restored from the cache) are left alone. If your repo has a `mise.toml`, you can declare plugins there under `[plugins]` instead and `mise install` fetches them without this input.

## Cache Configuration

You can customize the cache key used by the action:

```yaml
- uses: jdx/mise-action@v4
  with:
    cache_key: "my-custom-cache-key"  # Override the entire cache key
    cache_key_prefix: "mise-cache-v1"       # Or just change the prefix (default: "mise-v1")
```

### Using Another Cache Action

The built-in cache uses GitHub's cache. To store the cache elsewhere (for example with [runs-on/cache](https://github.com/runs-on/cache) and S3), turn the built-in cache off and cache the mise data directory yourself with any action that has the `actions/cache` interface:

```yaml
- uses: runs-on/cache@v4
  with:
    path: ~/.local/share/mise
    key: mise-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('**/mise.toml', '**/.mise.toml', '**/mise.*.toml', '**/.mise.*.toml', '**/mise.lock', '**/.mise.lock', '**/mise.*.lock', '**/.tool-versions') }}
- uses: jdx/mise-action@v4
  with:
    cache: false
```

The path to cache is mise's data directory, `~/.local/share/mise` by default (`%LOCALAPPDATA%\mise` on Windows). The action uses the first of these that is set: its `mise_dir` input, then `MISE_DATA_DIR`, then `$XDG_DATA_HOME/mise`, then the default above. If several are set, `path` must be the directory that wins in that order. Build the key from your config files as above (list every config name your repo uses, including environment-specific `mise.<env>.toml` files, since the key must change whenever the tools do), and add anything else that should invalidate it (`install_args`, `MISE_ENV`, the runner image).

### Template Variables in Cache Keys

When using `cache_key`, you can use template variables to reference internal values:

```yaml
- uses: jdx/mise-action@v4
  with:
    cache_key: "mise-{{platform}}-{{version}}-{{file_hash}}"
    version: "2026.3.10"
    install_args: "node python"
```

Available template variables:
- `{{version}}` - The mise version (from the `version` input)
- `{{cache_key_prefix}}` - The cache key prefix (from `cache_key_prefix` input or default)
- `{{platform}}` - The target platform, including the runner image (e.g., "linux-x64-ubuntu24", "macos-arm64-macos15", "linux-x64-self-hosted"). The trailing segment is `process.env.ImageOS` on github-hosted runners and falls back to `"self-hosted"` elsewhere — preventing cache collisions when the same repo runs on different runner providers (github-hosted, namespace.so, self-hosted).
- `{{file_hash}}` - Hash of all mise configuration files
- `{{mise_env}}` - The MISE_ENV environment variable value
- `{{install_args_hash}}` - SHA256 hash of the sorted tools from install args
- `{{bootstrap_hash}}` - SHA256 hash of bootstrap mode, skip list, and args
- `{{plugins_hash}}` - SHA256 hash of the `plugins` input (empty when unset)
- `{{default}}` - The processed default cache key (useful for extending)

Conditional logic is also supported using Handlebars syntax like `{{#if version}}...{{/if}}`.

Example using multiple variables:
```yaml
- uses: jdx/mise-action@v4
  with:
    cache_key: "mise-v1-{{platform}}-{{install_args_hash}}-{{file_hash}}"
    install_args: "node@24 python@3.14"
```

You can also extend the default cache key:
```yaml
- uses: jdx/mise-action@v4
  with:
    cache_key: "{{default}}-custom-suffix"
    install_args: "node@24 python@3.14"
```

This gives you full control over cache invalidation based on the specific aspects that matter to your workflow.

### Rust Cache

Rust has a known cache interaction because mise installs Rust through `rustup`.

mise records that Rust is installed in its own data directory, but `rustup` keeps the toolchain, components (`rustfmt`, `clippy`, ...), and targets in `~/.rustup` and `~/.cargo`. The action only caches the mise data directory, so a cache restore can bring back mise's "installed" marker without the components, and later steps fail with errors like a missing `rustfmt`. GitHub-hosted runners also ship their own `rustup`, which mise may reuse instead of installing its own.

Two ways to deal with it:

1. Keep rustup's state inside the mise data directory so it is cached together with it. This is complete, but the cache can get large (around 2.5 GB with several components and targets):

   ```yaml
   env:
     MISE_RUSTUP_HOME: /home/runner/.local/share/mise/rustup # macOS: /Users/runner/...
     MISE_CARGO_HOME: /home/runner/.local/share/mise/cargo
   ```

   These are the Linux paths (macOS runners use `/Users/runner/...`). On Windows the action caches `%LOCALAPPDATA%\mise` by default, so on GitHub-hosted Windows runners use `C:\Users\runneradmin\AppData\Local\mise\rustup` and `C:\Users\runneradmin\AppData\Local\mise\cargo` (on other runners, the same paths under that runner's `%LOCALAPPDATA%`). If you customize `mise_dir`, `MISE_DATA_DIR`, or `XDG_DATA_HOME`, keep these paths under the same directory.

2. Don't cache the toolchain through the action. Install Rust with `rustup` (or a dedicated action) and a Rust cache such as [Swatinem/rust-cache](https://github.com/Swatinem/rust-cache), and let mise manage everything else. For this to work, mise must no longer manage Rust: remove `rust` from `mise.toml` / `.tool-versions` (or keep it only in a config the CI job doesn't use, for example behind `MISE_ENV`), because the action runs `mise install` by default and would otherwise install Rust through mise and cache its install record again.

See [jdx/mise-action#215](https://github.com/jdx/mise-action/issues/215) for the discussion.

## Matrix Builds

To run the same job against several versions of a tool, override that tool with a `MISE_<TOOL>_VERSION` environment variable. The override applies on top of your repo's `mise.toml`, so every other tool is kept and the action installs only what the job needs:

```yaml
strategy:
  matrix:
    ruby-version: ["3.3", "3.4"]
env:
  MISE_RUBY_VERSION: ${{ matrix.ruby-version }}
steps:
  - uses: actions/checkout@v6
  - uses: jdx/mise-action@v4
    with:
      cache_key: "{{default}}-ruby${{ matrix.ruby-version }}"
  - run: mise exec -- ruby --version
```

Set the variable at the job level, as above, so later steps that run `mise exec`, `mise run` or a shim also use the matrix version. Setting it only on the action step doesn't carry over: the action exports what `mise env` reports, not its own `env`. Add the matrix value to `cache_key` so each version gets its own cache (see [Template Variables in Cache Keys](#template-variables-in-cache-keys)).

You can also use `mise x ruby@${{ matrix.ruby-version }} -- <command>` for a single command, which keeps the other tools from `mise.toml`.

The `mise_toml` input is not a good fit for matrices: it writes a `mise.toml` in the job's current directory that replaces the tools from your repo's own config, and a `.mise.toml` in that directory takes precedence over it, so the matrix value is silently ignored. The action warns when it sees this.

## GitHub API Rate Limits

When installing tools hosted on GitHub (like `gh`, `node`, `bun`, etc.), mise needs to make API calls to GitHub's releases API. Without authentication, these calls are subject to GitHub's rate limit of 60 requests per hour, which can cause installation failures.

```yaml
- uses: jdx/mise-action@v4
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    # your other configuration
```

**Note:** The action automatically uses `${{ github.token }}` as the default, so in most cases you don't need to explicitly provide it. However, if you encounter rate limit errors, make sure the token is being passed correctly.

### GitHub token persistence (unreleased)

`persist_github_token` is not available in the published `@v4`, `@v5`, or
`@v5.1.0` versions. Those versions still persist the action token automatically
and ignore this input. The examples below pin the unreleased implementation
commit that supports it. Use a release containing this change once available.

With this implementation, the token is available as `MISE_GITHUB_TOKEN` only
during this action by default (`persist_github_token: false`).
An existing `env.MISE_GITHUB_TOKEN` takes precedence over `github_token`.
To authenticate later shims, `mise exec`, or lazy installs, set
`persist_github_token: true` to export the action's token for subsequent steps:

```yaml
- uses: jdx/mise-action@2f1a5eb16aec0e6793d6a7e6ec2901969cf93f03 # unreleased persistence support
  with:
    persist_github_token: true
```

You can also persist a separate credential, such as a read-only token. The action
still authenticates its own tool installs with `github_token` (or an existing
`MISE_GITHUB_TOKEN`); later steps receive the separate token:

```yaml
- uses: jdx/mise-action@2f1a5eb16aec0e6793d6a7e6ec2901969cf93f03 # unreleased persistence support
  with:
    persist_github_token: ${{ secrets.READ_ONLY_TOKEN }}
```

Setting `persist_github_token: false` does not clear a token already set at the job
level or exported by an earlier step. This changes the previous behavior, which
persisted `github_token` automatically; workflows relying on it in later steps
should opt in explicitly.

## Lock Files

If a repo mise lock file such as `mise.lock` is present in the working
directory or one of its parents, this action automatically runs
`mise install --locked`. You can still pass `install_args`; `--locked`
will be added automatically unless you already included it yourself.

This auto-detection is intended for repo-managed config files. If you provide
`mise_toml` or `tool_versions` inputs, the action does not automatically force
locked mode.

## Bootstrap

Set `bootstrap: true` to run `mise bootstrap` instead of `mise install`:

```yaml
- uses: jdx/mise-action@v4
  with:
    bootstrap: true
```

When a repo mise lock file is present, the action automatically runs
`mise --locked bootstrap`. `install_args` cannot be combined with
`bootstrap: true`; use `bootstrap_skip` and `bootstrap_args` for bootstrap
customization.

## Alternative Installation

Alternatively, mise is easy to use in GitHub Actions even without this:

```yaml
jobs:
  build:
    steps:
    - run: |
        curl https://mise.run | sh
        echo "$HOME/.local/share/mise/bin" >> $GITHUB_PATH
        echo "$HOME/.local/share/mise/shims" >> $GITHUB_PATH
```
