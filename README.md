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
          version: 2026.3.10 # [default: latest] mise version to install
          install: true # [default: true] run `mise install`
          install_args: "bun" # [default: ""] additional arguments to `mise install`
          cache: true # [default: true] cache mise using GitHub's cache
          cache_rust: false # [default: false] also cache Rust toolchains installed by mise
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

## Cache Configuration

You can customize the cache key used by the action:

```yaml
- uses: jdx/mise-action@v4
  with:
    cache_key: "my-custom-cache-key"  # Override the entire cache key
    cache_key_prefix: "mise-v1"       # Or just change the prefix (default: "mise-v0")
```

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
- `{{cache_rust}}` - Whether the Rust toolchain cache integration is enabled
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

### Rust Toolchain Cache

By default, mise-action only caches mise's data directory. Rust is different from most mise tools because mise delegates Rust installation to rustup, which stores toolchains in `RUSTUP_HOME` and cargo/rustup proxy binaries in `CARGO_HOME/bin`. That state may live outside the mise data directory, so a restored mise cache can otherwise make `mise install` think Rust is present while components such as `rustfmt` or `clippy` are missing.

If mise is responsible for installing Rust in your workflow, opt in to Rust toolchain caching:

```yaml
- uses: jdx/mise-action@v4
  with:
    cache_rust: true
```

When enabled, the action exports `MISE_RUSTUP_HOME` and `MISE_CARGO_HOME` to directories under the mise data dir before cache restore and install. Those directories are then restored and saved with the normal mise cache. The default cache key includes a `-rust` segment when this option is enabled so Rust-enabled caches do not reuse older mise-only caches. If you override `cache_key`, include `{{cache_rust}}` or otherwise invalidate that key when enabling this option.

Leave `cache_rust` as `false` when Rust is installed or cached by another action such as `rustup`, `actions-rust-lang/setup-rust-toolchain`, or `Swatinem/rust-cache`, and you use mise for other tools. `Swatinem/rust-cache` remains useful alongside this option for Cargo registry, git dependency, and `target` build artifact caching.

## GitHub API Rate Limits

When installing tools hosted on GitHub (like `gh`, `node`, `bun`, etc.), mise needs to make API calls to GitHub's releases API. Without authentication, these calls are subject to GitHub's rate limit of 60 requests per hour, which can cause installation failures.

```yaml
- uses: jdx/mise-action@v4
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    # your other configuration
```

**Note:** The action automatically uses `${{ github.token }}` as the default, so in most cases you don't need to explicitly provide it. However, if you encounter rate limit errors, make sure the token is being passed correctly.

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
