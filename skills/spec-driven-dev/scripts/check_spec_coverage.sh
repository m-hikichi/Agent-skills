#!/usr/bin/env sh
# PostToolUse hook: check if a changed file is referenced by any SPEC contract.
# No local Python required. JSON parsing runs inside Docker.
# Outputs a warning message if the file is not covered by any SPEC.
set -eu

PROJECT_ROOT="${1:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
IMAGE="${VERIFY_SPEC_IMAGE:-python:3.12}"
HOOK_INPUT="$(cat)"

# Use Docker to extract file_path from hook input and check SPEC coverage
OUTPUT="$(printf '%s' "${HOOK_INPUT}" | docker run --rm -i \
  -v "${PROJECT_ROOT}:/workspace" \
  -w /workspace \
  "${IMAGE}" \
  python -c "
import json, sys, os, glob

data = json.load(sys.stdin)
fp = data.get('tool_input', {}).get('file_path', '') or data.get('tool_response', {}).get('filePath', '')
if not fp:
    sys.exit(0)

# Skip non-code files
skip_ext = {'.md', '.json', '.yaml', '.yml', '.toml', '.lock', '.txt', '.cfg', '.ini', '.gitignore'}
_, ext = os.path.splitext(fp)
if ext in skip_ext:
    sys.exit(0)

# Skip docs/config directories
for prefix in ('docs/', '.claude/', 'spec-config'):
    if fp.replace(os.sep, '/').startswith(prefix):
        sys.exit(0)

# Make path relative to workspace
try:
    rel = os.path.relpath(fp, '/workspace').replace(os.sep, '/')
except ValueError:
    rel = fp.replace(os.sep, '/')

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
