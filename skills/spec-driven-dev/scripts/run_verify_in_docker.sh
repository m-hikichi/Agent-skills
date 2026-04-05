#!/usr/bin/env bash
set -eu

PROJECT_ROOT_INPUT="${1:-.}"
IMAGE="${2:-${VERIFY_SPEC_IMAGE:-python:3.12}}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(CDPATH= cd -- "$PROJECT_ROOT_INPUT" && pwd)"

# Convert paths for Docker volume mounts on Windows (Git Bash / MSYS2)
to_docker_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s' "$1"
  fi
}

docker run --rm \
  -v "$(to_docker_path "$PROJECT_ROOT"):/workspace" \
  -v "$(to_docker_path "$PLUGIN_ROOT"):/plugin" \
  -w /workspace \
  "${IMAGE}" \
  python /plugin/scripts/verify_spec_consistency.py --project-root /workspace
