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
      - uses: actions/checkout@v4
      - uses: jdx/mise-action@v3
        with:
          version: 2024.10.0 # [default: latest] mise version to install
          sha256: "d38d4993c5379a680b50661f86287731dc1d1264777880a79b786403af337948" # [default: null] verify the checksum if the mise binary if set
          install: true # [default: true] run `mise install`
          install_args: "bun" # [default: ""] additional arguments to `mise install`
          cache: true # [default: true] cache mise using GitHub's cache
          experimental: true # [default: false] enable experimental features
          log_level: debug # [default: info] log level
          # automatically write this .tool-versions file
          tool_versions: |
            shellcheck 0.9.0
          # or, if you prefer .mise.toml format:
          mise_toml: |
            [tools]
            shellcheck = "0.9.0"
          working_directory: app # [default: .] directory to run mise in
          reshim: false # [default: false] run `mise reshim -f`
          github_token: ${{ secrets.GITHUB_TOKEN }} # [default: ${{ github.token }}] GitHub token for API authentication
      - run: shellcheck scripts/*.sh
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: jdx/mise-action@v3
      # .tool-versions will be read from repo root
      - run: node ./my_app.js
```

## Cache Configuration

You can customize the cache key used by the action:

```yaml
- uses: jdx/mise-action@v3
  with:
    cache_key: "my-custom-cache-key"  # Override the entire cache key
    cache_key_prefix: "mise-v1"       # Or just change the prefix (default: "mise-v0")
```

### Template Variables in Cache Keys

When using `cache_key`, you can use template variables to reference internal values:

```yaml
- uses: jdx/mise-action@v3
  with:
    cache_key: "mise-{{platform}}-{{version}}-{{file_hash}}"
    version: "2024.10.0"
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
- uses: jdx/mise-action@v3
  with:
    cache_key: "mise-v1-{{platform}}-{{install_args_hash}}-{{file_hash}}"
    install_args: "node@20 python@3.12"
```

You can also extend the default cache key:
```yaml
- uses: jdx/mise-action@v3
  with:
    cache_key: "{{default}}-custom-suffix"
    install_args: "node@20 python@3.12"
```

This gives you full control over cache invalidation based on the specific aspects that matter to your workflow.

## GitHub API Rate Limits

When installing tools hosted on GitHub (like `gh`, `node`, `bun`, etc.), mise needs to make API calls to GitHub's releases API. Without authentication, these calls are subject to GitHub's rate limit of 60 requests per hour, which can cause installation failures.

```yaml
- uses: jdx/mise-action@v3
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

## Renovate

If you use [Renovate](https://docs.renovatebot.com/), you can configure it to update the `mise-action` version automatically. Here's an example configuration:

First, set the mise version and sha256 in your GitHub action workflow file.
- The `sha256` is the checksum of the mise binary for the architecture you are using (e.g., `linux-x64`, `macos-arm64`).
- The `version` and `sha256` must be the first entries in the `with` block of the `jdx/mise-action` step:

```yaml

permissions: {}

jobs:
  lint:
    permissions: {}
    runs-on: ubuntu-24.04
    steps:
      - name: Check out
        with:
          persist-credentials: false
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - uses: jdx/mise-action@bfb9fa0b029db830a8c570757cee683df207a6c5 # v2.4.0
        with:
          version: v2025.7.11
          sha256: fe2d4c5c681c942b2f52bf0c71d04429ba4a5e090973514bde466a411190cd00
```

Then, add a custom manager to your Renovate configuration file (e.g., `renovate.json5`):

```json5
{
  $schema: "https://docs.renovatebot.com/renovate-schema.json",
  customManagers: [
    {
      customType: "regex",
      description: "update mise",
      managerFilePatterns: ["/(^|/)(workflow-templates|\\.(?:github|gitea|forgejo)/(?:workflows|actions))/.+\\.ya?ml$/", "/(^|/)action\\.ya?ml$/"],
      datasourceTemplate: "github-release-attachments",
      packageNameTemplate: "jdx/mise",
      depNameTemplate: "mise",
      matchStrings: ["jdx/mise-action.*\\n\\s*with:\\s*\\n\\s*version: [\"']?(?<currentValue>v[.\\d]+)[\"']?\\s*\\n\\s*sha256: [\"']?(?<currentDigest>\\w+)[\"']?"],
    },
  ],
}
```

