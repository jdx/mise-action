#!/usr/bin/env bash
set -euxo pipefail

function assert_equal() {
	if [ "$1" != "$2" ]; then
		echo "Assertion failed: Expected '$1', got '$2'" >&2
		return 1
	fi
}
EXPECTED_OUTPUT="jq-1.7.1"

assert_equal "$EXPECTED_OUTPUT" "$(mise exec -- jq --version)"
which jq

# windows bash does not seem to work with shims
if [[ "$(uname)" != "MINGW"* ]]; then
	assert_equal "$EXPECTED_OUTPUT" "$(jq --version)"
fi

# checking that environment variables set in mise.toml are properly set
assert_equal "${MY_ENV_VAR}" "abc"

# PATH modifications from mise.toml should not persist to subsequent steps
if [[ "$PATH" == *"mise-env-path"* ]]; then
	echo "mise env path unexpectedly exported to PATH: $PATH" >&2
	exit 1
fi
