#!/usr/bin/env bash
set -euxo pipefail

VERSION=$(jq -r .version package.json)

# push the current tag to github
git push origin "v$VERSION"
# set the v1 tag to this release
git tag v1 -f
# push the v1 tag to github
git push origin v1 -f
# create a release on github
gh release create "v$VERSION" --generate-notes --verify-tag
