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
- `{{platform}}` - The target platform (e.g., "linux-x64", "macos-arm64")
- `{{file_hash}}` - Hash of all mise configuration files
- `{{mise_env}}` - The MISE_ENV environment variable value
- `{{install_args_hash}}` - SHA256 hash of the sorted tools from install args
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

## Multi-Environment Workflows

Mise supports multiple environments through the `MISE_ENV` variable. The action provides an `environment` input to simplify multi-environment workflows:

```yaml
- name: Setup mise for preview environment
  uses: jdx/mise-action@v4
  with:
    environment: preview  # Automatically sets and exports MISE_ENV
    mise_toml: |
      [tools]
      node = "24"
      
      [env.preview]
      API_URL = "https://preview.example.com"
      
      [env.production]
      API_URL = "https://api.example.com"

- name: Deploy (MISE_ENV is available)
  run: mise run deploy
  # The preview environment is active, API_URL is set to preview URL
```

**Before (manual approach)**:
```yaml
- name: Export MISE_ENV
  run: echo "MISE_ENV=preview" >> $GITHUB_ENV

- name: Setup mise
  uses: jdx/mise-action@v4
  env:
    MISE_ENV: preview
```

**After (with environment input)**:
```yaml
- name: Setup mise
  uses: jdx/mise-action@v4
  with:
    environment: preview
```

### Environment Variable Precedence

If `MISE_ENV` is already set (e.g., at the job level), it takes precedence over the `environment` input:

```yaml
jobs:
  deploy:
    env:
      MISE_ENV: production  # This takes precedence
    steps:
      - uses: jdx/mise-action@v4
        with:
          environment: staging  # This will be ignored
```

### Cache Keys and Environments

The cache key automatically includes the environment when using the default cache key template. You can also reference it explicitly:

```yaml
- uses: jdx/mise-action@v4
  with:
    environment: preview
    cache_key: "mise-{{platform}}-{{mise_env}}-{{file_hash}}"
```

This ensures different environments maintain separate caches.

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
