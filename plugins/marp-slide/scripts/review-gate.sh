#!/usr/bin/env bash
# marp-slide rubric-v2 review state helper and Stop-hook gate.

MODE="gate"
SOURCE="slides/presentation.md"
REVIEW=".slide-work/review.json"
BLOCKED=".slide-work/review-blocked.json"
TARGET=""

while [ $# -gt 0 ]; do
  case "$1" in
    gate|hash|prepare) MODE="$1"; shift ;;
    --source) SOURCE="$2"; shift 2 ;;
    --review) REVIEW="$2"; shift 2 ;;
    --blocked) BLOCKED="$2"; shift 2 ;;
    --path) TARGET="$2"; shift 2 ;;
    *) TARGET="$1"; shift ;;
  esac
done

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print tolower($1)}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print tolower($1)}'
  else
    return 3
  fi
}

json_string() {
  tr -d '\n' < "$1" |
    grep -oE "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" |
    head -n1 |
    sed -E 's/.*:[[:space:]]*"([^"]*)".*/\1/'
}

json_number() {
  tr -d '\n' < "$1" |
    grep -oE "\"$2\"[[:space:]]*:[[:space:]]*[0-9]+" |
    head -n1 |
    grep -oE '[0-9]+$'
}

json_array_nonempty() {
  local seg content
  seg=$(tr -d '\n' < "$1" | grep -oE "\"$2\"[[:space:]]*:[[:space:]]*\[[^]]*\]" | head -n1)
  content=$(printf '%s' "$seg" | sed -E 's/.*\[([^]]*)\].*/\1/')
  if printf '%s' "$content" | grep -q '"'; then echo 1; else echo 0; fi
}

lower() { printf '%s' "$1" | tr 'A-Z' 'a-z'; }
block() { printf '%s\n' "$1" >&2; exit 2; }

if [ "$MODE" = "hash" ]; then
  f="${TARGET:-$SOURCE}"
  [ -f "$f" ] || { echo "File not found: $f" >&2; exit 1; }
  sha=$(sha256_of "$f") || { echo "No SHA-256 tool found" >&2; exit 1; }
  printf '{"source":"%s","sha256":"%s"}\n' "$f" "$sha"
  exit 0
fi

if [ "$MODE" = "prepare" ]; then
  [ -f "$SOURCE" ] || { echo "File not found: $SOURCE" >&2; exit 1; }
  sha=$(sha256_of "$SOURCE") || { echo "No SHA-256 tool found" >&2; exit 1; }
  previous=0
  if [ -f "$REVIEW" ]; then
    previous=$(json_number "$REVIEW" review_attempt)
    previous=${previous:-0}
  fi
  attempt=$((previous + 1))
  printf '{"rubric_version":2,"source_sha256":"%s","review_attempt":%s}\n' "$sha" "$attempt"
  exit 0
fi

[ -f "$SOURCE" ] || exit 0
current=$(sha256_of "$SOURCE") || block "review gate could not run: no SHA-256 tool on PATH"

if [ -f "$BLOCKED" ]; then
  bstatus=$(json_string "$BLOCKED" status)
  breason=$(json_string "$BLOCKED" reason)
  bsha=$(lower "$(json_string "$BLOCKED" source_sha256)")
  if [ "$bstatus" = "blocked" ] && [ "$breason" = "reviewer_unavailable" ] && [ "$bsha" = "$current" ]; then
    exit 0
  fi
fi

[ -f "$REVIEW" ] || block "review gate not satisfied: review.json is missing"
version=$(json_number "$REVIEW" rubric_version)
[ "$version" = "2" ] || block "review gate not satisfied: rubric_version must be 2; re-run the reviewer"

rstatus=$(json_string "$REVIEW" status)
[ -n "$rstatus" ] || block "review gate not satisfied: review status is missing"
rsha=$(lower "$(json_string "$REVIEW" source_sha256)")
[ "$rsha" = "$current" ] && shamatch=1 || shamatch=0

if [ "$rstatus" = "infra_blocked" ] && [ "$shamatch" = "1" ]; then
  exit 0
fi

if [ "$rstatus" = "pass" ]; then
  [ "$shamatch" = "1" ] || block "review gate not satisfied: pass review is stale"

  checked=$(json_number "$REVIEW" checked_page_count)
  checked=${checked:-0}
  imgs=$(json_array_nonempty "$REVIEW" page_images)
  [ "$checked" -gt 0 ] && [ "$imgs" = "1" ] ||
    block "review gate not satisfied: visual review did not inspect rendered PNG pages"

  pass_status_count=$(tr -d '\n' < "$REVIEW" | grep -oE '"status"[[:space:]]*:[[:space:]]*"pass"' | wc -l | tr -d ' ')
  [ "$pass_status_count" -ge 6 ] ||
    block "review gate not satisfied: all five rubric-v2 hard gates must pass"

  score_count=0
  low_score=0
  while IFS= read -r score; do
    [ -n "$score" ] || continue
    score_count=$((score_count + 1))
    [ "$score" -ge 4 ] || low_score=1
  done < <(tr -d '\n' < "$REVIEW" | grep -oE '"score"[[:space:]]*:[[:space:]]*[0-9]+' | grep -oE '[0-9]+$')
  [ "$score_count" -ge 4 ] && [ "$low_score" -eq 0 ] ||
    block "review gate not satisfied: all four quality scores must be at least 4"

  if grep -qE '"severity"[[:space:]]*:[[:space:]]*"(critical|major)"' "$REVIEW"; then
    block "review gate not satisfied: pass review contains critical or major issues"
  fi
  exit 0
fi

[ "$shamatch" = "1" ] && match_label="match" || match_label="mismatch/missing"
block "review gate not satisfied: status=$rstatus, source_sha256=$match_label"
