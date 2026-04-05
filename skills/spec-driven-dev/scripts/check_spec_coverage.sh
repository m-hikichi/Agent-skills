#!/usr/bin/env bash
# PostToolUse hook: check if a changed file is referenced by any SPEC contract.
# No local Python required. JSON parsing runs inside Docker.
# Outputs a warning message if the file is not covered by any SPEC.
set -eu

PROJECT_ROOT="${1:-${CLAUDE_PROJECT_DIR:-$(pwd)}}"
IMAGE="${VERIFY_SPEC_IMAGE:-python:3.12}"
HOOK_INPUT="$(cat)"

# Convert paths for Docker volume mounts on Windows (Git Bash / MSYS2)
to_docker_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s' "$1"
  fi
}

DOCKER_PROJECT_ROOT="$(to_docker_path "$PROJECT_ROOT")"

# Use Docker to extract file_path from hook input and check SPEC coverage
OUTPUT="$(printf '%s' "${HOOK_INPUT}" | docker run --rm -i \
  -v "${DOCKER_PROJECT_ROOT}:/workspace" \
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

# Normalize path: handle Windows-style paths (C:\..., /c/Users/...)
# Convert backslashes to forward slashes
fp = fp.replace(os.sep, '/').replace('\\\\', '/')
# Strip Windows drive letter prefix (e.g., C:/ or /c/)
fp = re.sub(r'^[A-Za-z]:/', '', fp)
fp = re.sub(r'^/[A-Za-z]/', '', fp)

# Skip docs/config directories
for prefix in ('docs/', '.claude/', 'spec-config'):
    if fp.startswith(prefix):
        sys.exit(0)

# Try to extract a project-relative path
# Look for common project root markers to find relative portion
# If the path contains known project structure directories, use from there
rel = fp

# Find spec directory from spec-config.json
spec_dir = 'docs/specs'
cfg_path = '/workspace/spec-config.json'
if os.path.exists(cfg_path):
    try:
        cfg = json.load(open(cfg_path, encoding='utf-8'))
        spec_dir = cfg.get('spec_dir', 'docs/specs')
        # Use source_roots from config to extract relative path
        src_roots = cfg.get('source_roots', [])
        for root in src_roots:
            root = root.rstrip('/')
            idx = fp.find(root + '/')
            if idx >= 0:
                rel = fp[idx:]
                break
    except Exception:
        pass

# If rel still looks like an absolute path, try to make it relative to workspace contents
if '/' in rel:
    # Check if any suffix of the path exists under /workspace
    parts = rel.split('/')
    for i in range(len(parts)):
        candidate = '/'.join(parts[i:])
        if os.path.exists(os.path.join('/workspace', candidate)):
            rel = candidate
            break

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
