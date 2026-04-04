#!/bin/bash
# notify.sh - OS通知ディスパッチャー（macOS / WSL / Windows Git Bash / Linux 対応）
# Usage: bash notify.sh "title" "message" ["mac_sound"] ["win_sound"]
#   mac_sound: Glass, Ping, Hero, Blow, Funk, etc. (default: Glass)
#   win_sound: Asterisk, Exclamation, Hand, Question (default: Asterisk)

TITLE="${1:-Claude Code}"
MESSAGE="${2:-通知}"
MAC_SOUND="${3:-Glass}"
WIN_SOUND="${4:-Asterisk}"

# --- PowerShell 実行コマンドの選択 (pwsh 優先) ---
if command -v pwsh.exe &>/dev/null; then
  PS_CMD="pwsh.exe"
elif command -v pwsh &>/dev/null; then
  PS_CMD="pwsh"
else
  PS_CMD="powershell.exe"
fi

# --- Windows (WSL / Git Bash) 共通の通知関数 ---
send_windows_notification() {
  # 環境変数経由で値を渡すことでインジェクションを防止
  NOTIFY_TITLE="$TITLE" NOTIFY_MSG="$MESSAGE" NOTIFY_SOUND="$WIN_SOUND" \
  "$PS_CMD" -Command '
    Add-Type -AssemblyName System.Windows.Forms

    # サウンド再生
    switch ($env:NOTIFY_SOUND) {
      "Exclamation" { [System.Media.SystemSounds]::Exclamation.Play() }
      "Hand"        { [System.Media.SystemSounds]::Hand.Play() }
      "Question"    { [System.Media.SystemSounds]::Question.Play() }
      default       { [System.Media.SystemSounds]::Asterisk.Play() }
    }

    # Toast 通知（失敗時はサウンドのみ）
    try {
      [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
      [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
      $title = [System.Security.SecurityElement]::Escape($env:NOTIFY_TITLE)
      $msg   = [System.Security.SecurityElement]::Escape($env:NOTIFY_MSG)
      $template = "<toast><visual><binding template=""ToastText02""><text id=""1"">" + $title + "</text><text id=""2"">" + $msg + "</text></binding></visual></toast>"
      $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
      $xml.LoadXml($template)
      $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Claude Code").Show($toast)
    } catch {
      # Toast 非対応環境ではサウンドのみで通知
    }
  ' 2>/dev/null
}

# --- OS 判定と通知送信 ---
OS="$(uname -s)"

case "$OS" in
  Darwin)
    # macOS: 引数渡しでインジェクションを防止
    osascript - "$TITLE" "$MESSAGE" "$MAC_SOUND" <<'APPLESCRIPT'
on run argv
  display notification (item 2 of argv) with title (item 1 of argv) sound name (item 3 of argv)
end run
APPLESCRIPT
    ;;

  Linux)
    if grep -qi microsoft /proc/version 2>/dev/null; then
      send_windows_notification
    else
      notify-send "$TITLE" "$MESSAGE" 2>/dev/null
    fi
    ;;

  MINGW*|MSYS*)
    # Windows ネイティブ (Git Bash)
    send_windows_notification
    ;;
esac
