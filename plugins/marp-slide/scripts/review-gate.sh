#!/usr/bin/env bash
# marp-slide deterministic completion gate / hash helper (host-side, portable).
#
# Works on Windows (Git Bash), macOS, and Linux. Decoupled from the Docker MCP
# server that exports PDF/PNG: depends only on a POSIX shell plus a SHA-256 tool
# (sha256sum or shasum) and grep/sed/awk. No Node, jq, Docker, or MCP needed.
#
# SHA-256 is computed over the raw file bytes, which is byte-identical to
# PowerShell Get-FileHash and Node crypto on the same bytes, so the write side
# (reviewer) and the check side (this gate) agree. Comparison is lower-cased.
#
# Modes:
#   gate  -> Stop-hook completion gate. exit 0 = allow stop; exit 2 = block stop
#            with the reason on stderr (Claude Code reads exit 2 as
#            "block the stop and feed stderr back to the model").
#   hash  -> prints {"source":..,"sha256":..} for the given file.
#
# Usage:
#   review-gate.sh gate [--source S] [--review R] [--blocked B]
#   review-gate.sh hash <file>

MODE="gate"
SOURCE="slides/presentation.md"
REVIEW=".slide-work/review.json"
BLOCKED=".slide-work/review-blocked.json"
TARGET=""

while [ $# -gt 0 ]; do
  case "$1" in
    gate|hash) MODE="$1"; shift ;;
    --source)  SOURCE="$2"; shift 2 ;;
    --review)  REVIEW="$2"; shift 2 ;;
    --blocked) BLOCKED="$2"; shift 2 ;;
    --path)    TARGET="$2"; shift 2 ;;
    *)         TARGET="$1"; shift ;;
  esac
done

sha256_of() {
  # Raw-byte SHA-256, lower-cased. Tries sha256sum then shasum (macOS).
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print tolower($1)}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print tolower($1)}'
  else
    return 3
  fi
}

# Extract the first JSON string value for a top-level-ish key: "key": "value"
json_string() {
  tr -d '\n' < "$1" \
    | grep -oE "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" \
    | head -n1 \
    | sed -E "s/.*:[[:space:]]*\"([^\"]*)\".*/\1/"
}

# Extract the first integer value for a key: "key": 12
json_number() {
  tr -d '\n' < "$1" \
    | grep -oE "\"$2\"[[:space:]]*:[[:space:]]*[0-9]+" \
    | head -n1 \
    | grep -oE "[0-9]+$"
}

# Echo 1 if the array for "key" has at least one element, else 0.
json_array_nonempty() {
  local seg content
  seg=$(tr -d '\n' < "$1" | grep -oE "\"$2\"[[:space:]]*:[[:space:]]*\[[^]]*\]" | head -n1)
  content=$(printf '%s' "$seg" | sed -E 's/.*\[([^]]*)\].*/\1/')
  if printf '%s' "$content" | grep -q '"'; then echo 1; else echo 0; fi
}

lower() { printf '%s' "$1" | tr 'A-Z' 'a-z'; }

# ---- hash mode ------------------------------------------------------------
if [ "$MODE" = "hash" ]; then
  f="${TARGET:-$SOURCE}"
  if [ ! -f "$f" ]; then echo "File not found: $f" >&2; exit 1; fi
  sha=$(sha256_of "$f") || { echo "No SHA-256 tool (sha256sum/shasum) found" >&2; exit 1; }
  printf '{"source":"%s","sha256":"%s"}\n' "$f" "$sha"
  exit 0
fi

# ---- gate mode ------------------------------------------------------------
allow() { exit 0; }
block() { printf '%s\n' "$1" >&2; exit 2; }

# 1. No deck yet -> legitimate idle state.
[ -f "$SOURCE" ] || allow

current=$(sha256_of "$SOURCE") || block "review gate could not run: no SHA-256 tool (sha256sum/shasum) on PATH. Allowing is unsafe; install one."

# 2. Legitimate reviewer-unavailable stop, scoped to the current source.
if [ -f "$BLOCKED" ]; then
  bstatus=$(json_string "$BLOCKED" status)
  breason=$(json_string "$BLOCKED" reason)
  bsha=$(lower "$(json_string "$BLOCKED" source_sha256)")
  if [ "$bstatus" = "blocked" ] && [ "$breason" = "reviewer_unavailable" ] && [ "$bsha" = "$current" ]; then
    allow
  fi
fi

# 3. Review state must exist and be readable.
if [ ! -f "$REVIEW" ]; then
  block "review gate not satisfied: .slide-work/review.json is missing. Invoke the reviewer subagent (or write review-blocked.json if it cannot run)."
fi
rstatus=$(json_string "$REVIEW" status)
if [ -z "$rstatus" ]; then
  block "review gate not satisfied: .slide-work/review.json is unreadable or has no status. Re-run the reviewer."
fi
rsha=$(lower "$(json_string "$REVIEW" source_sha256)")
if [ "$rsha" = "$current" ]; then shamatch=1; else shamatch=0; fi

# 4. Infrastructure failure recorded for the current source -> allow.
if [ "$rstatus" = "infra_blocked" ] && [ "$shamatch" = "1" ]; then allow; fi

# 5. A genuine pass: status pass, hash matches, visual review really ran.
if [ "$rstatus" = "pass" ]; then
  if [ "$shamatch" != "1" ]; then
    block "review gate not satisfied: status=pass but source_sha256 does not match the current source (stale review). Re-run the reviewer."
  fi
  checked=$(json_number "$REVIEW" checked_page_count); checked=${checked:-0}
  imgs=$(json_array_nonempty "$REVIEW" page_images)
  if [ "$checked" -le 0 ] || [ "$imgs" != "1" ]; then
    block "review gate not satisfied: status=pass but visual_review did not run (checked_page_count=0 / page_images empty). Have the reviewer redo the PNG visual review."
  fi
  allow
fi

# 6. Anything else (fail / missing_info / unknown) -> block with the status.
if [ "$shamatch" = "1" ]; then ml="match"; else ml="mismatch/missing"; fi
block "review gate not satisfied: status=$rstatus, source_sha256=$ml. Act on review.json.exact_fix_instructions or questions_for_user."
