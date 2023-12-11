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
      - uses: actions/checkout@v3
      - uses: jdx/rtx-action@v1
        with:
          tool_versions: |
            shellcheck 0.9.0
      - run: shellcheck scripts/*.sh
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: jdx/rtx-action@v1
      # .tool-versions will be read from repo root
      - run: node ./my_app.js
```

Alternatively, rtx is easy to use in GitHub Actions even without this:

```yaml
jobs:
  build:
    steps:
    - run: |
        curl https://rtx.jdx.dev/install.sh | sh
        echo "$HOME/.local/share/rtx/bin" >> $GITHUB_PATH
        echo "$HOME/.local/share/rtx/shims" >> $GITHUB_PATH
```
