#!/usr/bin/env bash
set -euxo pipefail

VERSION=$(jq -r .version package.json)
MAJOR_VERSION=$(echo "$VERSION" | cut -d. -f1)

# create the version tag (allow it to fail if it already exists)
git tag "v$VERSION" || echo "Tag v$VERSION already exists locally"

# push changes to github
git push
# push the current tag to github
git push origin "v$VERSION" || echo "Tag v$VERSION already exists on remote"

# set the major version tag to this release
git tag "v$MAJOR_VERSION" -f
# push the major version tag to github (retry with pull if it fails)
if ! git push origin "v$MAJOR_VERSION" -f; then
  echo "Failed to push v$MAJOR_VERSION tag, pulling and retrying..."
  git fetch origin "refs/tags/v$MAJOR_VERSION:refs/tags/v$MAJOR_VERSION" -f
  git tag "v$MAJOR_VERSION" -f
  git push origin "v$MAJOR_VERSION" -f
fi

# check if release already exists before creating
if gh release view "v$VERSION" >/dev/null 2>&1; then
  echo "Release v$VERSION already exists, skipping creation"
else
  # create a release on github
  gh release create "v$VERSION" --generate-notes --verify-tag
fi
