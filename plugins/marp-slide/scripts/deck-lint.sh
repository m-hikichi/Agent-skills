#!/usr/bin/env bash
# Structural lint for marp-slide v0.8. Quality judgments belong to the reviewer.

SOURCE="slides/presentation.md"
TARGET=""
SLIDE_COUNT_MODE="target"
THEME_FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --slide-count-mode) SLIDE_COUNT_MODE="$2"; shift 2 ;;
    --theme) THEME_FILE="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

fails=0
warns=0
fail() { printf 'FAIL: %s\n' "$1"; fails=$((fails + 1)); }
warn() { printf 'WARN: %s\n' "$1"; warns=$((warns + 1)); }

if [ ! -f "$SOURCE" ]; then
  echo "FAIL: file not found: $SOURCE" >&2
  exit 1
fi

first_line=$(sed -n '1{s/\r$//;p;}' "$SOURCE")
[ "$first_line" = "---" ] || fail "Marp YAML frontmatter must start on line 1"

frontmatter=$(awk '
  NR == 1 { next }
  /^---\r?$/ { exit }
  { sub(/\r$/, ""); print }
' "$SOURCE")

printf '%s\n' "$frontmatter" | grep -qE '^marp:[[:space:]]*true[[:space:]]*$' ||
  fail "frontmatter must contain marp: true"

theme_name=$(printf '%s\n' "$frontmatter" | sed -nE 's/^theme:[[:space:]]*([^[:space:]]+).*/\1/p' | head -n1)
has_inline_style=0
printf '%s\n' "$frontmatter" | grep -qE '^style:[[:space:]]*[|>]' && has_inline_style=1

if [ -n "$THEME_FILE" ]; then
  if [ ! -f "$THEME_FILE" ]; then
    fail "theme file not found: $THEME_FILE"
  elif [ "${THEME_FILE##*.}" != "css" ]; then
    fail "theme file must have .css extension: $THEME_FILE"
  else
    declared_theme=$(sed -nE 's|^/\*[[:space:]]*@theme[[:space:]]+([^[:space:]*]+).*$|\1|p' "$THEME_FILE" | head -n1)
    [ -n "$declared_theme" ] || fail "theme file has no /* @theme name */ declaration: $THEME_FILE"
    if [ -n "$theme_name" ] && [ -n "$declared_theme" ] && [ "$theme_name" != "$declared_theme" ]; then
      fail "frontmatter theme '$theme_name' does not match CSS theme '$declared_theme'"
    fi
  fi
elif [ -z "$theme_name" ] && [ "$has_inline_style" -eq 0 ]; then
  warn "no external theme name or inline style is declared"
fi

separator_count=$(grep -cE '^---\r?$' "$SOURCE")
slide_count=$((separator_count - 1))
[ "$slide_count" -gt 0 ] || fail "could not determine slide count"

if [ -n "$TARGET" ]; then
  case "$TARGET" in
    *[!0-9]*|'') fail "target slide count must be a positive integer: $TARGET" ;;
    *)
      if [ "$SLIDE_COUNT_MODE" = "exact" ] && [ "$slide_count" -ne "$TARGET" ]; then
        fail "exact slide count required: actual=$slide_count target=$TARGET"
      elif [ "$SLIDE_COUNT_MODE" = "target" ] && [ "$slide_count" -ne "$TARGET" ]; then
        warn "slide count differs from target: actual=$slide_count target=$TARGET"
      elif [ "$SLIDE_COUNT_MODE" != "exact" ] && [ "$SLIDE_COUNT_MODE" != "target" ] && [ "$SLIDE_COUNT_MODE" != "flexible" ]; then
        fail "slide-count-mode must be exact, target, or flexible"
      fi
      ;;
  esac
fi

source_dir=$(dirname "$SOURCE")
assets=$(
  {
    grep -oE '!\[[^]]*\]\([^)]+\)' "$SOURCE" | sed -E 's/^.*\]\(([^)]+)\)$/\1/' || true
    grep -oE '<img[^>]+src="[^"]+"' "$SOURCE" | sed -E 's/^.*src="([^"]+)".*$/\1/' || true
  } | sed -E 's/^<([^>]+)>$/\1/' | sort -u
)

if [ -n "$assets" ]; then
  while IFS= read -r asset; do
    case "$asset" in
      http://*|https://*|data:*|'') continue ;;
    esac
    asset=${asset%%#*}
    asset=${asset%%\?*}
    [ -f "$source_dir/$asset" ] || fail "referenced local asset not found: $asset"
  done <<< "$assets"
fi

printf '%s slides checked: %s fail(s), %s warning(s)\n' "$slide_count" "$fails" "$warns"
[ "$fails" -eq 0 ] || exit 1
exit 0
