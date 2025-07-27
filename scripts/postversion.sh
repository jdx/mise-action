#!/usr/bin/env bash
set -euxo pipefail

VERSION=$(jq -r .version package.json)
MAJOR_VERSION=$(echo "$VERSION" | cut -d. -f1)

# push changes to github
git push
# push the current tag to github
git push origin "v$VERSION"
# set the major version tag to this release
git tag "v$MAJOR_VERSION" -f
# push the major version tag to github
git push origin "v$MAJOR_VERSION" -f
# create a release on github
gh release create "v$VERSION" --generate-notes --verify-tag
