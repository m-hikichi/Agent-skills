#!/usr/bin/env bash
# marp-slide deterministic density lint (host-side, portable).
#
# Machine-checkable subset of the review gates, for fast feedback BEFORE the
# reviewer runs (S2b self-check) and as a reviewer pre-check. The reviewer's
# PNG visual review + review.json remain the only authority — this lint never
# writes review state and is NOT part of the Stop-hook completion gate.
#
# Works on Windows (Git Bash), macOS, and Linux. Bash only, no jq/Node/Docker.
#
# Checks (FAIL -> exit 1):
#   L1 title length   : h1 title longer than 40 chars (JP chars count as 1)
#   L3 bullets        : more than 3 bullets in one consecutive list block
#                       (two-column layouts legitimately hold 3 per column)
#   L4 text density   : more than 6 text lines (excl. headings/labels/tags)
#   L5 class variety  : same _class on 3+ consecutive slides
#   L7 slide count    : |count - target| > 3 (only when --target given)
# Warnings (WARN -> reported, exit unaffected):
#   L2 multi-claim    : title contains および/ならびに/かつ (split candidate)
#   L6 missing class  : slide has no <!-- _class: ... --> directive
#
# Usage:
#   deck-lint.sh [--source slides/presentation.md] [--target N]

SOURCE="slides/presentation.md"
TARGET=""

while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    *) SOURCE="$1"; shift ;;
  esac
done

[ -f "$SOURCE" ] || { echo "FAIL: file not found: $SOURCE" >&2; exit 1; }

# Char-accurate length for Japanese needs a UTF-8 locale.
case "${LC_ALL:-${LANG:-}}" in
  *[Uu][Tt][Ff]*8*) : ;;
  *)
    for loc in C.UTF-8 en_US.UTF-8 ja_JP.UTF-8; do
      if locale -a 2>/dev/null | grep -qix "$loc"; then export LC_ALL="$loc"; break; fi
    done ;;
esac

fails=0
warns=0
fail() { printf 'FAIL slide %s: %s\n' "$1" "$2"; fails=$((fails + 1)); }
warn() { printf 'WARN slide %s: %s\n' "$1" "$2"; warns=$((warns + 1)); }

slide=0          # current slide number (1-origin, after frontmatter)
in_front=0       # inside YAML frontmatter
front_done=0
in_comment=0     # inside multi-line HTML comment
first=1

cur_class=""
cur_title=""
bullet_run=0
max_bullet_run=0
textlines=0
prev_class="__none__"
run_len=0

end_bullet_run() {
  [ "$bullet_run" -gt "$max_bullet_run" ] && max_bullet_run=$bullet_run
  bullet_run=0
}

flush_slide() {
  [ "$slide" -eq 0 ] && return
  end_bullet_run
  # L1 / L2: title checks
  if [ -n "$cur_title" ]; then
    tlen=${#cur_title}
    if [ "$tlen" -gt 40 ]; then
      fail "$slide" "L1 title is ${tlen} chars (max 40): ${cur_title}"
    fi
    case "$cur_title" in
      *および*|*ならびに*|*かつ*)
        warn "$slide" "L2 title may hold two claims (および/ならびに/かつ) — consider splitting" ;;
    esac
  fi
  # L3: bullets per consecutive block
  if [ "$max_bullet_run" -gt 3 ]; then
    fail "$slide" "L3 ${max_bullet_run} bullets in one block (max 3)"
  fi
  # L4: text density
  if [ "$textlines" -gt 6 ]; then
    fail "$slide" "L4 ${textlines} text lines excluding title/labels (max 6)"
  fi
  # L6: class presence, L5: consecutive runs
  if [ -z "$cur_class" ]; then
    warn "$slide" "L6 no _class directive (every slide should pick an archetype)"
    prev_class="__none__"; run_len=0
  else
    if [ "$cur_class" = "$prev_class" ]; then
      run_len=$((run_len + 1))
      if [ "$run_len" -eq 3 ]; then
        fail "$slide" "L5 same archetype '$cur_class' on 3 consecutive slides"
      fi
    else
      prev_class="$cur_class"; run_len=1
    fi
  fi
}

new_slide() {
  flush_slide
  slide=$((slide + 1))
  cur_class=""; cur_title=""; bullet_run=0; max_bullet_run=0; textlines=0
}

while IFS= read -r line || [ -n "$line" ]; do
  # --- frontmatter fence handling ---
  if [ "$first" -eq 1 ]; then
    first=0
    if [ "$line" = "---" ]; then in_front=1; continue; fi
    new_slide
  fi
  if [ "$in_front" -eq 1 ]; then
    if [ "$line" = "---" ]; then in_front=0; front_done=1; new_slide; fi
    continue
  fi
  [ "$front_done" -eq 0 ] && [ "$slide" -eq 0 ] && new_slide

  # --- slide separator ---
  if [ "$line" = "---" ]; then new_slide; continue; fi

  # --- multi-line HTML comment state ---
  if [ "$in_comment" -eq 1 ]; then
    case "$line" in *'-->'*) in_comment=0 ;; esac
    continue
  fi
  case "$line" in
    *'<!--'*'-->'*)
      # single-line comment: may carry the class directive
      cls=$(printf '%s' "$line" | sed -n 's/.*_class:[[:space:]]*\([A-Za-z0-9_-]*\).*/\1/p')
      [ -n "$cls" ] && [ -z "$cur_class" ] && cur_class="$cls"
      continue ;;
    *'<!--'*) in_comment=1; continue ;;
  esac

  # --- strip trailing CR (Git Bash safety) and skip blanks ---
  line=${line%$'\r'}
  trimmed=$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  if [ -z "$trimmed" ]; then end_bullet_run; continue; fi

  case "$trimmed" in
    '# '*)
      if [ -z "$cur_title" ]; then
        cur_title=$(printf '%s' "$trimmed" | sed 's/^# *//; s/\*\*//g; s/\*//g')
      fi
      continue ;;
    '##'*) continue ;;                                  # h2/h3: headings excluded
    '!['*) continue ;;                                  # image-only line
  esac

  # pure HTML tag line (no visible text) — also delimits list blocks
  if printf '%s' "$trimmed" | grep -qE '^(<[^<>]+>)+$'; then
    end_bullet_run; continue
  fi
  # short label components (pill / col-label / meta / stat value etc.)
  if printf '%s' "$trimmed" | grep -qE '^<(span|div) class="(pill|col-label|meta|chapter|step-no|cta-no|cta-meta|value|unit|label|quote-attr)'; then
    continue
  fi

  # top-level bullet (column 0 only; indented lines are sub-bullets)?
  case "$line" in
    '- '*|'* '*) bullet_run=$((bullet_run + 1)); textlines=$((textlines + 1)); continue ;;
  esac
  if printf '%s' "$line" | grep -qE '^[0-9]+\. '; then
    bullet_run=$((bullet_run + 1)); textlines=$((textlines + 1)); continue
  fi

  end_bullet_run
  textlines=$((textlines + 1))
done < "$SOURCE"
flush_slide

# L7: slide count vs target
if [ -n "$TARGET" ]; then
  diff=$((slide - TARGET)); [ "$diff" -lt 0 ] && diff=$((-diff))
  if [ "$diff" -gt 3 ]; then
    printf 'FAIL deck: L7 %s slides vs target %s (allowed +/-3)\n' "$slide" "$TARGET"
    fails=$((fails + 1))
  fi
fi

printf '%s slides checked: %s fail(s), %s warning(s)\n' "$slide" "$fails" "$warns"
[ "$fails" -eq 0 ] || exit 1
exit 0
