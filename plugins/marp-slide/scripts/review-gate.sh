#!/usr/bin/env bash
# Deprecated compatibility wrapper. Use marp-slide.mjs directly.
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MODE=${1:-gate}
case "$MODE" in
  gate) shift || true; COMMAND=gate ;;
  prepare) shift; COMMAND=prepare-review ;;
  validate) shift; COMMAND=validate-review ;;
  finalize) shift; COMMAND=finalize ;;
  fingerprint|hash) shift; COMMAND=fingerprint ;;
  *) COMMAND=$MODE ;;
esac
exec bash "$SCRIPT_DIR/run-cli.sh" "$COMMAND" "$@"
