#!/usr/bin/env sh
set -eu

PROJECT_ROOT_INPUT="${1:-.}"
IMAGE="${2:-${VERIFY_SPEC_IMAGE:-python:3.12}}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(CDPATH= cd -- "$PROJECT_ROOT_INPUT" && pwd)"

docker run --rm \
  -v "${PROJECT_ROOT}:/workspace" \
  -v "${SKILL_DIR}:/skill" \
  -w /workspace \
  "${IMAGE}" \
  python /skill/scripts/verify_spec_consistency.py --project-root /workspace
