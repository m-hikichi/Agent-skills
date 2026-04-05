#!/usr/bin/env bash
# Stop/SubagentStop hook: run spec-driven-dev completion gate.
# No local Python required. All Python runs inside Docker.
#
# Structure:
#   1. Run review_stop_gate.py inside Docker (consistency check + audit format)
#   2. Run project_test_commands on the host (they typically use docker compose)
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! . "${SCRIPT_DIR}/_docker_helpers.sh" 2>/dev/null; then
  printf "ERROR: _docker_helpers.sh not found in %s\n" "${SCRIPT_DIR}" >&2
  exit 1
fi

PROJECT_ROOT="${1:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"
IMAGE="${VERIFY_SPEC_IMAGE:-python:3.12}"

DOCKER_PROJECT_ROOT="$(to_docker_path "$PROJECT_ROOT")"
DOCKER_PLUGIN_ROOT="$(to_docker_path "$PLUGIN_ROOT")"

# Read hook input from stdin
HOOK_INPUT="$(cat)"

# --- Step 1: Run review_stop_gate.py inside Docker ---
# This handles: audit format check + verify_spec_consistency.py
if ! OUTPUT="$(printf "%s" "${HOOK_INPUT}" | docker_run run --rm -i \
  -v "${DOCKER_PROJECT_ROOT}:/workspace" \
  -v "${DOCKER_PLUGIN_ROOT}:/plugin" \
  -w /workspace \
  "${IMAGE}" \
  python /plugin/scripts/review_stop_gate.py --project-root /workspace 2>&1)"; then
  # Docker execution failed
  if [ -n "${OUTPUT}" ]; then
    printf "%s\n" "${OUTPUT}" >&2
  else
    printf "spec-driven-dev stop reviewer failed.\n" >&2
  fi
  exit 2
fi

# If review_stop_gate.py output a block decision, pass it through
if [ -n "${OUTPUT}" ]; then
  # Check if it contains a block decision
  case "${OUTPUT}" in
    *'"decision"'*'"block"'*)
      printf "%s\n" "${OUTPUT}"
      exit 0
      ;;
  esac
fi

# --- Step 2: Run project_test_commands on the host ---
# These commands typically use docker compose themselves
CONFIG_FILE="${PROJECT_ROOT}/spec-config.json"
if [ ! -f "${CONFIG_FILE}" ]; then
  printf '{"decision":"block","reason":"reviewer NG: spec-config.json が見つかりません: %s"}\n' "${CONFIG_FILE}"
  exit 0
fi

# Extract project_test_commands using Docker (no local Python/jq needed)
COMMANDS="$(docker_run run --rm -i \
  -v "${DOCKER_PROJECT_ROOT}:/workspace" \
  -w /workspace \
  "${IMAGE}" \
  python -c "
import json, sys
cfg = json.load(open('/workspace/spec-config.json', encoding='utf-8'))
cmds = cfg.get('verification', {}).get('project_test_commands', [])
for c in cmds:
    s = str(c).strip()
    if s:
        print(s)
" 2>/dev/null || true)"

if [ -z "${COMMANDS}" ]; then
  printf '{"decision":"block","reason":"reviewer NG: verification.project_test_commands が空です。プロジェクト固有テストを 1 件以上設定してください。"}\n'
  exit 0
fi

# Run each command on the host (here-doc avoids piped subshell so exit works)
while IFS= read -r CMD; do
  if [ -z "${CMD}" ]; then
    continue
  fi
  if ! CMD_OUTPUT="$(bash -c "${CMD}" 2>&1)"; then
    # Truncate and escape output for JSON block reason
    SUMMARY="$(printf "%s" "${CMD_OUTPUT}" | head -10 | tr '\n' ' ' | tr '\r' ' ')"
    printf '{"decision":"block","reason":"reviewer NG: project_test_commands が失敗しました。 `%s` failed: %s"}\n' "${CMD}" "${SUMMARY}"
    exit 0
  fi
done <<EOF
${COMMANDS}
EOF

exit 0
