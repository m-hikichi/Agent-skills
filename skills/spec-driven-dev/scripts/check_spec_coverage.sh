#!/usr/bin/env bash
# PostToolUse hook: check if a changed file is referenced by any SPEC contract.
# No local Python required. JSON parsing runs inside Docker.
# Outputs a warning message if the file is not covered by any SPEC.
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! . "${SCRIPT_DIR}/_docker_helpers.sh" 2>/dev/null; then
  printf "ERROR: _docker_helpers.sh not found in %s\n" "${SCRIPT_DIR}" >&2
  exit 1
fi

PROJECT_ROOT="${1:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
IMAGE="${VERIFY_SPEC_IMAGE:-python:3.12}"
HOOK_INPUT="$(cat)"

DOCKER_PROJECT_ROOT="$(to_docker_path "$PROJECT_ROOT")"

# Use Docker to extract file_path from hook input and check SPEC coverage
OUTPUT="$(printf '%s' "${HOOK_INPUT}" | docker_run run --rm -i \
  -v "${DOCKER_PROJECT_ROOT}:/workspace" \
  -e "HOST_PROJECT_ROOT=${DOCKER_PROJECT_ROOT}" \
  -w /workspace \
  "${IMAGE}" \
  python -c "
import json, sys, os, glob, re

data = json.load(sys.stdin)
fp = data.get('tool_input', {}).get('file_path', '') or data.get('tool_response', {}).get('filePath', '')
if not fp:
    sys.exit(0)

# Skip non-code files
skip_ext = {'.md', '.json', '.yaml', '.yml', '.toml', '.lock', '.txt', '.cfg', '.ini', '.gitignore'}
_, ext = os.path.splitext(fp)
if ext in skip_ext:
    sys.exit(0)

# Normalize path: convert backslashes to forward slashes and strip drive letter.
# HOST_PROJECT_ROOT is passed via to_docker_path (forward-slash mixed format),
# but fp from Claude Code may contain backslashes on Windows.
def normalize(p):
    p = p.replace(chr(92), '/')
    p = re.sub(r'^[A-Za-z]:/', '', p)
    p = re.sub(r'^/[A-Za-z]/', '', p)
    return p.rstrip('/')

host_root = normalize(os.environ.get('HOST_PROJECT_ROOT', ''))
fp_norm = normalize(fp)

# Strip project root prefix to get relative path
if host_root and fp_norm.startswith(host_root + '/'):
    rel = fp_norm[len(host_root) + 1:]
else:
    rel = fp_norm

# Skip docs/config directories
for prefix in ('docs/', '.claude/', 'spec-config'):
    if rel.startswith(prefix):
        sys.exit(0)

# Find spec directory from spec-config.json
spec_dir = 'docs/specs'
cfg_path = '/workspace/spec-config.json'
if os.path.exists(cfg_path):
    try:
        cfg = json.load(open(cfg_path, encoding='utf-8'))
        spec_dir = cfg.get('spec_dir', 'docs/specs')
    except Exception:
        pass

spec_path = os.path.join('/workspace', spec_dir)
if not os.path.isdir(spec_path):
    sys.exit(0)

# Check if the file is referenced in any SPEC's contract table
found = False
for md in sorted(glob.glob(os.path.join(spec_path, '*.md'))):
    content = open(md, encoding='utf-8').read()
    if rel in content:
        found = True
        break

if not found:
    result = {
        'hookSpecificOutput': {
            'hookEventName': 'PostToolUse',
            'additionalContext': f'[spec-driven-dev 警告] {rel} はどの SPEC の実装トレーサビリティ契約にも記載されていません。このファイルの変更が仕様に影響する場合は、対応する SPEC の契約表とマトリクスを更新してください。'
        }
    }
    json.dump(result, sys.stdout, ensure_ascii=False)
    print()
" 2>/dev/null || true)"

if [ -n "${OUTPUT}" ]; then
  printf "%s\n" "${OUTPUT}"
fi

exit 0
