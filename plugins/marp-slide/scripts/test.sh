#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cp "$ROOT/skills/main/templates/presentation-starter.md" "$TMP/deck.md"
cp "$ROOT/skills/main/templates/themes/executive-clean.css" "$TMP/theme.css"

bash "$ROOT/scripts/deck-lint.sh" --source "$ROOT/scripts/fixtures/legacy-inline.md" --target 2 --slide-count-mode exact

bash "$ROOT/scripts/deck-lint.sh"   --source "$TMP/deck.md"   --target 6   --slide-count-mode exact   --theme "$TMP/theme.css"

if bash "$ROOT/scripts/deck-lint.sh"   --source "$TMP/deck.md"   --target 7   --slide-count-mode exact   --theme "$TMP/theme.css" >/dev/null 2>&1; then
  echo "expected exact slide count mismatch to fail" >&2
  exit 1
fi

cp "$TMP/deck.md" "$TMP/missing-asset.md"
printf '\n![missing](assets/not-found.svg)\n' >> "$TMP/missing-asset.md"
if bash "$ROOT/scripts/deck-lint.sh"   --source "$TMP/missing-asset.md"   --slide-count-mode flexible   --theme "$TMP/theme.css" >/dev/null 2>&1; then
  echo "expected missing local asset to fail" >&2
  exit 1
fi

mkdir -p "$TMP/.slide-work" "$TMP/rendered-pages"
prepare=$(bash "$ROOT/scripts/review-gate.sh" prepare   --source "$TMP/deck.md"   --review "$TMP/.slide-work/review.json")
printf '%s' "$prepare" | grep -q '"rubric_version":2'
printf '%s' "$prepare" | grep -q '"review_attempt":1'
sha=$(printf '%s' "$prepare" | sed -nE 's/.*"source_sha256":"([^"]+)".*/\1/p')

cat > "$TMP/.slide-work/review.json" <<JSON
{
  "rubric_version": 2,
  "status": "pass",
  "source_sha256": "$sha",
  "review_attempt": 1,
  "issues": [],
  "hard_gates": {
    "H1": {"status": "pass"},
    "H2": {"status": "pass"},
    "H3": {"status": "pass"},
    "H4": {"status": "pass"},
    "H5": {"status": "pass"}
  },
  "scores": {
    "a": {"score": 4},
    "b": {"score": 4},
    "c": {"score": 5},
    "d": {"score": 4}
  },
  "artifacts": {"page_images": ["$TMP/rendered-pages/page-001.png"]},
  "visual_review": {"checked_page_count": 6}
}
JSON

bash "$ROOT/scripts/review-gate.sh" gate   --source "$TMP/deck.md"   --review "$TMP/.slide-work/review.json"   --blocked "$TMP/.slide-work/review-blocked.json"

printf '\n<!-- stale -->\n' >> "$TMP/deck.md"
set +e
bash "$ROOT/scripts/review-gate.sh" gate   --source "$TMP/deck.md"   --review "$TMP/.slide-work/review.json"   --blocked "$TMP/.slide-work/review-blocked.json" >/dev/null 2>&1
stale_status=$?
set -e
[ "$stale_status" -eq 2 ] || {
  echo "expected stale pass to exit 2, got $stale_status" >&2
  exit 1
}

current_sha=$(bash "$ROOT/scripts/review-gate.sh" hash "$TMP/deck.md" | sed -nE 's/.*"sha256":"([^"]+)".*/\1/p')
sed -e 's/"rubric_version": 2/"rubric_version": 1/' \
    -e "s/\"source_sha256\": \"[^\"]*\"/\"source_sha256\": \"$current_sha\"/" \
    "$TMP/.slide-work/review.json" > "$TMP/.slide-work/old-review.json"
set +e
bash "$ROOT/scripts/review-gate.sh" gate \
  --source "$TMP/deck.md" \
  --review "$TMP/.slide-work/old-review.json" \
  --blocked "$TMP/.slide-work/review-blocked.json" >/dev/null 2>&1
old_rubric_status=$?
set -e
[ "$old_rubric_status" -eq 2 ] || {
  echo "expected rubric v1 review to exit 2, got $old_rubric_status" >&2
  exit 1
}

sed -e "s/\"source_sha256\": \"[^\"]*\"/\"source_sha256\": \"$current_sha\"/" \
    -e 's/"checked_page_count": 6/"checked_page_count": 0/' \
    "$TMP/.slide-work/review.json" > "$TMP/.slide-work/no-visual-review.json"
set +e
bash "$ROOT/scripts/review-gate.sh" gate \
  --source "$TMP/deck.md" \
  --review "$TMP/.slide-work/no-visual-review.json" \
  --blocked "$TMP/.slide-work/review-blocked.json" >/dev/null 2>&1
no_visual_status=$?
set -e
[ "$no_visual_status" -eq 2 ] || {
  echo "expected missing visual review to exit 2, got $no_visual_status" >&2
  exit 1
}

for example in proposal executive-update report training research; do
  case "$example" in
    proposal|executive-update) theme=executive-clean ;;
    report|research) theme=editorial ;;
    training) theme=technical ;;
  esac
  bash "$ROOT/scripts/deck-lint.sh"     --source "$ROOT/skills/main/templates/examples/$example.md"     --slide-count-mode flexible     --theme "$ROOT/skills/main/templates/themes/$theme.css"
done

echo "marp-slide tests passed"
