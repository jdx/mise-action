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
      - uses: jdx/mise-action@v2
        with:
          version: 2024.10.0 # [default: latest] mise version to install
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
      - run: shellcheck scripts/*.sh
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: jdx/mise-action@v2
      # .tool-versions will be read from repo root
      - run: node ./my_app.js
```

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

## Install a subset of configured tools

When a job needs only some of the tools in your `mise.toml`, set mise's
[`MISE_ENABLE_TOOLS`](https://mise.jdx.dev/configuration/settings.html#enable_tools)
setting at the job level:

```yaml
jobs:
  validate:
    runs-on: ubuntu-latest
    env:
      MISE_ENABLE_TOOLS: rust
    steps:
      - uses: actions/checkout@v6
      - uses: jdx/mise-action@v5
        with:
          cache_key: "{{default}}-{{env.MISE_ENABLE_TOOLS}}"
      - run: mise run validate
```

This is a mise setting, not a mise-action input. Setting it at the job level
limits the tools mise enables both when the action installs tools and in later
commands such as `mise run`. By contrast, `install_args` only limits the tools
installed by the action's `mise install` invocation; a later `mise run` may
install other configured tools. Include the setting in a custom cache key when
different jobs use different allowlists, as the default key does not include
`MISE_ENABLE_TOOLS`.
