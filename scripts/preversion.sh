#!/usr/bin/env bash
set -euxo pipefail

git cliff -o CHANGELOG.md --tag "${npm_package_version:?}"
git add CHANGELOG.md
