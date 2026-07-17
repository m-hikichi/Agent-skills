#!/usr/bin/env bash
# Compatibility launcher only. Lifecycle business rules live in marp-slide.mjs.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PLUGIN_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
WORKSPACE=$(pwd)
FORWARDED_ARGS=()
EXPECT_ROOT=0
for ARG in "$@"; do
  if [ "$EXPECT_ROOT" -eq 1 ]; then
    WORKSPACE=$(CDPATH= cd -- "$ARG" && pwd)
    EXPECT_ROOT=0
  elif [ "$ARG" = "--root" ]; then
    EXPECT_ROOT=1
  else
    FORWARDED_ARGS+=("$ARG")
  fi
done
if [ "$EXPECT_ROOT" -eq 1 ]; then
  echo "Option --root requires a value" >&2
  exit 1
fi

# Stop hooks call `gate` for every Claude Code turn. Avoid requiring Node or
# Docker when the selected workspace has no active marp-slide run marker.
if [ "${1:-}" = "gate" ]; then
  if [ ! -f "$WORKSPACE/.slide-work/run-state.json" ]; then
    exit 0
  fi
fi

if command -v node >/dev/null 2>&1; then
  exec node "$SCRIPT_DIR/marp-slide.mjs" "$@"
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "marp-slide requires either Node.js or Docker with the marp-mcp-server image" >&2
  exit 1
fi

WORKSPACE_MODE=rw
if [ "${1:-}" = "gate" ]; then
  WORKSPACE_MODE=ro
fi

exec docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --entrypoint node \
  -v "$PLUGIN_ROOT:/plugin:ro" \
  -v "$WORKSPACE:/workspace:$WORKSPACE_MODE" \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m \
  -w /workspace \
  marp-mcp-server \
  /plugin/scripts/marp-slide.mjs "${FORWARDED_ARGS[@]}" --root /workspace
