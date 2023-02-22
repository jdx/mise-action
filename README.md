## Example Workflow

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
      - uses: jdxcode/rtx-action@v1
        with:
          tool_versions: |
            shellcheck 0.9.0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - run: shellcheck scripts/*.sh
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: jdxcode/rtx-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      # .tool-versions will be read from repo root
      - run: node ./my_app.js
```
