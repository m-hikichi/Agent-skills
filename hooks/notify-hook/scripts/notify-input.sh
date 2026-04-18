#!/bin/bash
# notify-input.sh - Claude Code が入力・許可待ちの際の通知
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

MESSAGE="入力または許可が必要です"

# stdin から hook の JSON 入力を読み込む
INPUT=$(cat)

# Notification イベントのメッセージを取得（jq が使える場合）
if command -v jq &>/dev/null; then
  HOOK_MSG=$(echo "$INPUT" | jq -r '.message // empty' 2>/dev/null)
  if [[ -n "$HOOK_MSG" ]]; then
    MESSAGE="${HOOK_MSG:0:100}"
  fi
fi

bash "$SCRIPT_DIR/notify.sh" "Claude Code" "$MESSAGE" "Ping" "Asterisk"
