# トラブルシューティング

## MCPが起動しない

`docker image inspect json-video-studio:0.1.0`と`docker network inspect json-video-studio`を確認します。見つからなければ[READMEのAI不要セットアップ](../README.md#セットアップai不要)を再実行します。`.mcp.json`変更後は新しいClaude Codeセッションを開始します。

stdoutはMCP JSON-RPC専用です。runtimeの診断ログをstdoutへ追加すると接続が壊れるため、ログはstderrへ出します。

## リポジトリの変更が反映されない

[READMEの更新手順](../README.md#4-既存の個人用コピーを更新する)に従います。個人用コピーを自動上書きせず、更新後は新しいClaude Codeセッションで確認します。

## UIを開けない

初版のUIはMCP serverと同じコンテナで起動し、`http://127.0.0.1:43120`だけに公開します。ポート競合時は既存のJSON Video Studio Claudeセッションを終了してください。外部interfaceへのbindへ変更しないでください。

## VOICEVOXへ接続できない

```sh
docker compose -f compose.voicevox.yml ps
docker compose -f compose.voicevox.yml logs voicevox
```

Engine起動直後はspeaker modelの準備に時間がかかる場合があります。`http://127.0.0.1:50021/version`が応答することを確認し、[READMEの再診断](../README.md#5-セットアップオプションと再診断)を実行します。コンテナ内runtimeは`http://voicevox:50021`を使います。

## speaker/styleがない

VOICEVOXの`/speakers`はEngine versionごとに確認します。表示名だけでstyle IDを推測せず、UUIDとstyle IDを選び直してからresolveします。選んだキャラクターの利用規約も再確認します。

## lockがstale

JSONやasset内容を変更した正常な結果です。validate → resolve → storyboard reviewを再実行します。古いlockのhashを書き換えたり、frozen lockを無効化したりしません。

## renderに失敗する

job errorの`code`、`jsonPointer`、`hint`を確認します。`output_inspect`でFFmpegのcodec情報を確認し、途中生成物を完成品として扱いません。同じ出力ディレクトリへ上書きせず、新しいlock hashで再実行します。

## 文字が切れる

長い台詞を複数sceneへ分割し、bulletsを3件程度、字幕を1行24〜32全角文字程度へ短くします。font sizeを極端に小さくしてゲートを通さず、storyboardを再生成して`video-reviewer`へ戻します。
