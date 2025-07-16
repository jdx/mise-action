#!/usr/bin/env bash
# shellcheck shell=bash
set -euxo pipefail

# Get current version from package.json
cur_version="$(jq -r .version package.json)"

# Check if this version has already been released
released_versions="$(git tag --list | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$')"
if ! echo "$released_versions" | grep -q "^v$cur_version$"; then
  git tag -d "v$cur_version"
  node ./scripts/postversion.sh
fi

# Get the next version and changelog from git-cliff
version="$(git cliff --bumped-version)"
changelog="$(git cliff --bump --unreleased --strip all)"

if [ "${DRY_RUN:-1}" == 1 ]; then
  echo "version: $version"
  echo "changelog: $changelog"
  exit 0
fi

# Configure git for automated commits
git config user.name mise-en-dev
git config user.email 123107610+mise-en-dev@users.noreply.github.com

# Update package.json version
npm version "${version#v}" --no-git-tag-version

# Create release branch and commit
git checkout -B release
git commit -m "chore: release $version"

# Push to release branch
git push origin release --force

# Create or update PR
gh pr create --title "chore: release $version" --body "$changelog" --label "release" ||
  gh pr edit --title "chore: release $version" --body "$changelog" 
