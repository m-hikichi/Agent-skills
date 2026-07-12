#!/usr/bin/env bash
# Deprecated compatibility wrapper for the Node test suite.
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if command -v node >/dev/null 2>&1; then
  exec node --test "$SCRIPT_DIR/tests"/*.test.mjs
fi
exec docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges \
  --entrypoint node \
  -v "$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd):/plugin:ro" \
  -w /plugin \
  marp-mcp-server --test /plugin/scripts/tests/marp-slide.test.mjs
