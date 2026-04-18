#!/bin/bash
# notify-stop.sh - Claude Code タスク完了時の通知
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

MESSAGE="タスクが完了しました"

# stdin から hook の JSON 入力を読み込む
INPUT=$(cat)

# transcript_path から最後のアシスタントメッセージを取得（jq が使える場合）
if command -v jq &>/dev/null; then
  TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
  if [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
    # JSON Array 形式と JSONL 形式の両方に対応
    LAST_MSG=$(jq -r '
      if type == "array" then .[] else . end
      | select(.role == "assistant")
      | .content
      | if type == "array" then .[0].text else . end
    ' "$TRANSCRIPT_PATH" 2>/dev/null | tail -1)
    if [[ -n "$LAST_MSG" ]]; then
      MESSAGE="${LAST_MSG:0:100}"
    fi
  fi
fi

bash "$SCRIPT_DIR/notify.sh" "Claude Code" "$MESSAGE" "Glass" "Exclamation"
