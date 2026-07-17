#!/usr/bin/env bash
# Deprecated compatibility wrapper. Use marp-slide.mjs lint directly.
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec bash "$SCRIPT_DIR/run-cli.sh" lint "$@"
