#!/usr/bin/env bash
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! . "${SCRIPT_DIR}/_docker_helpers.sh" 2>/dev/null; then
  printf "ERROR: _docker_helpers.sh not found in %s\n" "${SCRIPT_DIR}" >&2
  exit 1
fi

PROJECT_ROOT_INPUT="${1:-.}"
IMAGE="${2:-${VERIFY_SPEC_IMAGE:-python:3.12}}"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(CDPATH= cd -- "$PROJECT_ROOT_INPUT" && pwd)"

docker_run run --rm \
  -v "$(to_docker_path "$PROJECT_ROOT"):/workspace" \
  -v "$(to_docker_path "$PLUGIN_ROOT"):/plugin" \
  -w /workspace \
  "${IMAGE}" \
  python /plugin/scripts/verify_spec_consistency.py --project-root /workspace
