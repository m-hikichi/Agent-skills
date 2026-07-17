#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SCRIPT="$SCRIPT_DIR/eval-harness.mjs"

if command -v node >/dev/null 2>&1; then
  exec node "$SCRIPT" "$@"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Node.js or Docker is required to run the evaluation harness." >&2
  exit 1
fi

PLUGIN_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../../.." && pwd)
HOST_ROOT=$(pwd -P)
IMAGE=${MARP_SLIDE_IMAGE:-marp-mcp-server}

# Docker fallback deliberately accepts only paths below the current directory.
# Run this launcher from a common parent of the plugin snapshots and workspace.
ARGS_FILE=$(mktemp)
trap 'rm -f "$ARGS_FILE"' EXIT HUP INT TERM
EXPECT_PATH=0
for TOKEN in "$@"; do
  if [ "$EXPECT_PATH" -eq 1 ]; then
    case "$TOKEN" in
      /*) ABS="$TOKEN" ;;
      *..*) echo "Docker fallback rejects parent traversal in path: $TOKEN" >&2; exit 1 ;;
      *) ABS="$HOST_ROOT/$TOKEN" ;;
    esac
    case "$ABS" in
      "$HOST_ROOT") printf '%s\n' '/workspace' >> "$ARGS_FILE" ;;
      "$HOST_ROOT"/*) printf '%s\n' "/workspace/${ABS#"$HOST_ROOT"/}" >> "$ARGS_FILE" ;;
      *) echo "Docker fallback path must stay under $HOST_ROOT: $TOKEN" >&2; exit 1 ;;
    esac
    EXPECT_PATH=0
    continue
  fi
  printf '%s\n' "$TOKEN" >> "$ARGS_FILE"
  case "$TOKEN" in
    --workspace|--baseline-plugin|--candidate-plugin|--render-root|--output|--baseline|--report) EXPECT_PATH=1 ;;
  esac
done
[ "$EXPECT_PATH" -eq 0 ] || { echo "path flag requires a value" >&2; exit 1; }

# Newlines in CLI arguments are intentionally unsupported by this evaluation launcher.
set --
while IFS= read -r TOKEN; do set -- "$@" "$TOKEN"; done < "$ARGS_FILE"
docker run --rm --network none --entrypoint node \
  -v "$HOST_ROOT:/workspace" \
  -v "$PLUGIN_ROOT:/plugin:ro" \
  -w /workspace \
  "$IMAGE" \
  /plugin/skills/main/evals/scripts/eval-harness.mjs \
  "$@"
