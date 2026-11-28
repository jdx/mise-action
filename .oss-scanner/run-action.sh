#!/usr/bin/env bash
# Run this action offline against the mise in this image, through jactionlint's local runner
# (https://jactionlint.jdx.dev/run) and .oss-scanner/workflow.yml. Extra arguments go to `jactionlint run`:
#
#   .oss-scanner/run-action.sh --net=none --no-cache   # the action alone, nothing cached
#   .oss-scanner/run-action.sh -i cache=true           # save the mise directory to the runner's local
#                                                      # cache service; a second run restores it
#
# The cache service listens on 127.0.0.1, so the second form works without the internet too. Its entries
# are under ~/.cache/jactionlint/cache (`jactionlint cache ls`).
set -euo pipefail
cd "$(dirname "$0")/.."

mise_bin="${MISE_DATA_DIR:?}/bin/mise"
version="$("$mise_bin" --version | cut -d' ' -f1)"
sha256="$(sha256sum "$mise_bin" | cut -d' ' -f1)"

# Steps run in jactionlint's Landlock sandbox. Where the kernel can't apply it, run them without it:
# the scanner's VM is the boundary here.
sandbox=()
if ! jactionlint run --check-sandbox >/dev/null 2>&1; then
  echo "run-action.sh: the sandbox is not available here, so steps run with --sandbox=off" >&2
  sandbox=(--sandbox=off)
fi

# Steps start from this PATH. Leave mise's own directories off it, so that the mise a step finds is the
# one the action added through GITHUB_PATH, but keep node, which runs the action.
jactionlint="$(mise which jactionlint)"
node_bin="$(dirname "$(mise which node)")"
step_path="$node_bin"
IFS=: read -ra dirs <<<"$PATH"
for dir in "${dirs[@]}"; do
  case "$dir" in
  "$MISE_DATA_DIR"/bin | "$MISE_DATA_DIR"/shims | "$MISE_DATA_DIR"/installs/*) ;;
  *) step_path="$step_path:$dir" ;;
  esac
done

PATH="$step_path" exec "$jactionlint" run .oss-scanner/workflow.yml -e workflow_dispatch \
  --allow-write "$MISE_DATA_DIR" -i version="$version" -i sha256="$sha256" "${sandbox[@]}" "$@"
