#!/bin/bash
# notify.sh - OS通知ディスパッチャー（macOS / WSL / Windows Git Bash / Linux 対応）
# Usage: bash notify.sh "title" "message" ["mac_sound"] ["win_sound"]
#   mac_sound: Glass, Ping, Hero, Blow, Funk, etc. (default: Glass)
#   win_sound: Asterisk, Exclamation, Hand, Question (default: Asterisk)

TITLE="${1:-Claude Code}"
MESSAGE="${2:-通知}"
MAC_SOUND="${3:-Glass}"
WIN_SOUND="${4:-Asterisk}"

# --- PowerShell 実行コマンドの選択 ---
# Toast 通知は WinRT (Windows.UI.Notifications) を使うため、
# WinRT 型を ContentType=WindowsRuntime で読み込める Windows PowerShell 5.1
# (powershell.exe) を採用する。pwsh 7+ は WinRT 型ロードに非対応のため、
# 採用するとトーストが表示されずサウンドのみになる。
PS_CMD="powershell.exe"

# --- アイコンの Windows パスと file:/// URI を返す ---
# 環境変数 CLAUDE_NOTIFY_ICON でバリアントを選択:
#   "dark"  (default) -> claude-icon-dark.png  (公式アプリアイコン: 黒背景+オレンジ)
#   "light"           -> claude-icon-light.png (透明背景+オレンジのみ)
#   その他           -> 絶対パスとして解釈 (任意の PNG を指定可能)
# stdout: "<windows_path>|<file_uri>" 形式。アイコンが無ければ空文字。
resolve_icon_paths() {
  local script_dir
  script_dir="$(cd "$(dirname "$0")" && pwd)"

  local variant="${CLAUDE_NOTIFY_ICON:-dark}"
  local icon_path
  case "$variant" in
    dark)  icon_path="$script_dir/claude-icon-dark.png" ;;
    light) icon_path="$script_dir/claude-icon-light.png" ;;
    *)     icon_path="$variant" ;;
  esac
  [ -f "$icon_path" ] || return 0

  local win_path=""
  if command -v cygpath &>/dev/null; then
    win_path="$(cygpath -w "$icon_path")"
  elif command -v wslpath &>/dev/null; then
    win_path="$(wslpath -w "$icon_path")"
  else
    win_path="$icon_path"
  fi
  printf '%s|file:///%s' "$win_path" "${win_path//\\//}"
}

# --- Windows (WSL / Git Bash) 共通の通知関数 ---
send_windows_notification() {
  local resolved icon_win icon_uri
  resolved="$(resolve_icon_paths)"
  icon_win="${resolved%%|*}"
  icon_uri="${resolved#*|}"
  [ "$icon_uri" = "$resolved" ] && icon_uri=""  # 区切り文字無し（=アイコン無し）

  # 環境変数経由で値を渡すことでインジェクションを防止
  NOTIFY_TITLE="$TITLE" NOTIFY_MSG="$MESSAGE" NOTIFY_SOUND="$WIN_SOUND" \
  NOTIFY_ICON_URI="$icon_uri" NOTIFY_ICON_PATH="$icon_win" \
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
      # Windows 11 は未登録 AppUserModelID のトーストをサイレント抑制するため、
      # HKCU 配下に DisplayName/IconUri を登録して "Claude Code" として認識させる。
      # IconUri はバリアント切替を即反映できるよう毎回上書きする。
      $appId = "Claude.Code.Notification"
      $regPath = "HKCU:\Software\Classes\AppUserModelId\$appId"
      if (-not (Test-Path $regPath)) { New-Item -Path $regPath -Force | Out-Null }
      Set-ItemProperty -Path $regPath -Name "DisplayName"    -Value "Claude Code" -Type String
      Set-ItemProperty -Path $regPath -Name "ShowInSettings" -Value 0             -Type DWord
      if ($env:NOTIFY_ICON_PATH) {
        Set-ItemProperty -Path $regPath -Name "IconUri"             -Value $env:NOTIFY_ICON_PATH -Type String
        Set-ItemProperty -Path $regPath -Name "IconBackgroundColor" -Value "FF000000"            -Type String
      }

      [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
      [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
      $title = [System.Security.SecurityElement]::Escape($env:NOTIFY_TITLE)
      $msg   = [System.Security.SecurityElement]::Escape($env:NOTIFY_MSG)
      $imageXml = ""
      if ($env:NOTIFY_ICON_URI) {
        $iconSrc = [System.Security.SecurityElement]::Escape($env:NOTIFY_ICON_URI)
        $imageXml = "<image placement=""appLogoOverride"" src=""" + $iconSrc + """/>"
      }
      $template = "<toast><visual><binding template=""ToastGeneric""><text>" + $title + "</text><text>" + $msg + "</text>" + $imageXml + "</binding></visual></toast>"
      $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
      $xml.LoadXml($template)
      $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
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
