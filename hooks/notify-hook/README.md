# Claude Code 通知 Hook セットアップ

macOS / Windows (WSL・Git Bash) / Linux に対応した、タスク完了・入力待ち通知の設定です。

---

## ファイル構成

```
~/.claude/
├── settings.json          # Hook 設定
└── scripts/
    ├── notify.sh          # OS通知ディスパッチャー（共通）
    ├── notify-stop.sh     # タスク完了時の通知（Stop イベント）
    └── notify-input.sh    # 入力・許可待ちの通知（Notification イベント）
```

---

## セットアップ手順

以下のコマンドはリポジトリのルートディレクトリから実行してください。

```bash
# 1. スクリプトフォルダを作成
mkdir -p ~/.claude/scripts

# 2. スクリプトをコピーして配置
cp hooks/notify-hook/scripts/notify.sh    ~/.claude/scripts/notify.sh
cp hooks/notify-hook/scripts/notify-stop.sh  ~/.claude/scripts/notify-stop.sh
cp hooks/notify-hook/scripts/notify-input.sh ~/.claude/scripts/notify-input.sh

# 3. 実行権限を付与（macOS / Linux のみ、Windows Git Bash では不要）
chmod +x ~/.claude/scripts/notify.sh
chmod +x ~/.claude/scripts/notify-stop.sh
chmod +x ~/.claude/scripts/notify-input.sh
```

### settings.json を配置（既存ファイルがある場合はマージ）

既存の `~/.claude/settings.json` がない場合:
```bash
cp hooks/notify-hook/settings.json ~/.claude/settings.json
```

既存の `~/.claude/settings.json` がある場合は、`"hooks"` のブロックを既存ファイルにマージしてください。

---

## macOS 追加設定（重要）

osascript は Script Editor 経由で通知を送るため、**通知の許可設定**が必要です。

1. ターミナルで以下を一度実行して通知をテスト：
   ```bash
   osascript -e 'display notification "テスト" with title "Claude Code" sound name "Glass"'
   ```
2. 通知が出ない場合：**システム設定 → 通知 → Script Editor** を探して「通知を許可」をオン

---

## 動作確認

Claude Code を起動して `/hooks` と入力すると、設定した Hook の一覧が確認できます。

```
/hooks
```

---

## Hook イベントの説明

| イベント       | タイミング                         | スクリプト          |
|-------------|--------------------------------|-----------------|
| `Stop`      | タスクが完了し、応答が終わったとき            | notify-stop.sh  |
| `Notification` | Claudeが入力・許可を待っているとき        | notify-input.sh |

---

## 対応環境

| 環境 | 通知方法 | サウンド |
|------|---------|---------|
| macOS | osascript (ネイティブ通知) | カスタマイズ可 |
| Windows WSL | PowerShell Toast 通知 (pwsh 優先) | SystemSounds |
| Windows Git Bash | PowerShell Toast 通知 (pwsh 優先) | SystemSounds |
| Linux | notify-send | - |

---

## カスタマイズ

### macOS のサウンドを変更

`notify-stop.sh` と `notify-input.sh` 内の `notify.sh` 呼び出しの第3引数を変更：

使えるサウンド名：`Glass` `Ping` `Hero` `Blow` `Funk` `Bottle` `Frog` `Pop` `Purr` `Sosumi` `Submarine` `Tink`

### Windows のサウンドを変更

`notify.sh` 呼び出しの第4引数を変更：

使えるサウンド名：`Asterisk` `Exclamation` `Hand` `Question`

### 通知メッセージを変更

各スクリプトの `MESSAGE` 変数を編集してください。
