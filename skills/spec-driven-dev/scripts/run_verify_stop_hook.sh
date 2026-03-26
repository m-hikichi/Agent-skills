#!/usr/bin/env sh
set -eu

PROJECT_ROOT="${1:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REVIEWER="${SCRIPT_DIR}/review_stop_gate.py"

if command -v python3 >/dev/null 2>&1 && python3 -V >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1 && python -V >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  printf "spec-driven-dev stop hook requires python3 or python on the host machine.\n" >&2
  exit 2
fi

HOOK_INPUT="$(cat)"

if OUTPUT="$(printf "%s" "${HOOK_INPUT}" | "${PYTHON_BIN}" "${REVIEWER}" --project-root "${PROJECT_ROOT}" 2>&1)"; then
  if [ -n "${OUTPUT}" ]; then
    printf "%s\n" "${OUTPUT}"
  fi
  exit 0
fi

if [ -n "${OUTPUT}" ]; then
  printf "%s\n" "${OUTPUT}" >&2
else
  printf "spec-driven-dev stop reviewer failed.\n" >&2
fi

exit 2
