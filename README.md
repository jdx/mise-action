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

## Outputs

The action provides the following outputs:

| Output | Description |
|--------|-------------|
| `cache-hit` | Boolean indicating if the cache was restored |
| `versions` | JSON object with all active tool versions and metadata |
| `<tool-name>` | Version string for each active tool (e.g., `bun`, `node`, `python`) |

### Using Tool Version Outputs

After mise installs tools, you can access the resolved versions directly without needing a separate step:

```yaml
- name: Setup tools with Mise
  id: mise
  uses: jdx/mise-action@v4

# Access individual tool versions directly
- name: Cache bun
  uses: actions/cache@v5
  with:
    path: ~/.bun/install/cache
    key: bun-cache-${{ runner.os }}-${{ steps.mise.outputs.bun }}-${{ hashFiles('**/bun.lock') }}

# Or use the full versions JSON for complex scenarios
- name: Show all versions
  run: echo '${{ steps.mise.outputs.versions }}'
```

The `versions` output contains full metadata for each active tool:

```json
{
  "bun": {
    "version": "1.0.0",
    "requested_version": "latest",
    "install_path": "/home/runner/.local/share/mise/installs/bun/1.0.0",
    "source": {
      "type": "mise.toml",
      "path": "/home/runner/work/repo/mise.toml"
    }
  },
  "node": {
    "version": "20.10.0",
    "requested_version": "20",
    "install_path": "/home/runner/.local/share/mise/installs/node/20.10.0"
  }
}
```

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
