#!/usr/bin/env bash
set -euxo pipefail

function assert_equal() {
  if [ "$1" != "$2" ]; then
    echo "Assertion failed: Expected '$1', got '$2'" >&2
    return 1
  fi
}

assert_equal "v22.0.0" "$(mise exec -- node --version)"
which node

# windows bash does not seem to work with shims
if [[ "$(uname)" != "MINGW"* ]]; then
  assert_equal "v22.0.0" "$(node --version)"
fi
