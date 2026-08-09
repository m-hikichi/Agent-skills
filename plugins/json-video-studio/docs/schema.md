# Schemaと必要データ

編集JSONの正本は`schemas/video-project.schema.json`、生成lockの契約は`schemas/project-lock.schema.json`です。どちらもJSON Schema Draft 2020-12です。編集JSONはAjv strict modeで検証し、TypeScript型はSchemaから生成します。

## 利用者が用意するデータ

- 動画の目的、視聴者、タイトル、section構成、台詞
- 話者。VOICEVOXならspeaker UUIDとstyle ID、ユーザー音声ならローカル音声asset
- 任意の画像、動画、BGM、avatar PNG（v0.1のフォントはDocker同梱の`Noto Sans CJK JP`固定）
- 各素材の権利状態、作者、出典、ライセンス、必要な帰属表記
- themeの色とサムネイルの1〜2行の文言

avatarやBGMは任意です。素材がなくても固定テンプレートとVOICEVOXだけで動画を作れます。

## sceneの3方式

| 方式 | 必須 | 書かない項目 | 尺の正本 |
|---|---|---|---|
| ユーザー音声 | `audioAssetId` | `durationMs` | ffprobe実測値 |
| VOICEVOX | `speakerId`, `text` | `audioAssetId`, `durationMs` | 生成WAVのffprobe実測値 |
| 無音 | `durationMs` | `speakerId`, `audioAssetId` | `durationMs` |

`holdAfterMs`はどの方式にも追加できます。frame数は`ceil((audioDurationMs + holdAfterMs) / 1000 × 30)`です。

sceneへ効果音を重ねる場合は、`sfxAssetId`に`audio` assetのIDを指定します。これは3方式の尺の正本を変更せず、`audio.sfxVolume`で全体音量を調整します。

## outputs

v0.1の動画制作と必須レビュー工程を成立させるため、`outputs.video`と`outputs.storyboard`は常に`true`です。MP4とstoryboard/contact sheetは省略できません。`outputs.captions`、`outputs.chapters`、`outputs.thumbnail`だけを任意に`true`または`false`へ設定できます。

## Schemaだけでは検証できない規則

runtimeのsemantic validatorが次を確認します。

- asset、speaker、section、scene IDの一意性
- `speakerId`、`assetId`、背景、BGM、avatar表情の参照先
- 参照用途とasset typeの一致
- asset実体、realpath containment、symlink、MIME、拡張子
- VOICEVOX speaker UUID/styleの実在
- `metric.values`と`labels`の要素数
- 合計尺と`maxDurationMinutes`
- `unknown`権利と`allowUnknownRights`

## パス

asset `path`は`video-project.json`の存在するprojectルートからの相対パスです。`assets/image.png`のように指定します。次は拒否されます。

```text
C:\Users\name\image.png
/home/name/image.png
../outside/image.png
\\server\share\image.png
https://example.com/image.png
file:///tmp/image.png
```

SVGはv0.1で受け付けません。信頼できるSVGもPNG/WebPへrasterizeしてから登録します。

## lock

`project.lock.json`はresolveが生成し、手編集しません。project digest、asset hash/MIME/寸法/時間、VOICEVOX生成音声、scene frame境界、runtime version、credits、warningsを持ちます。編集JSONのdigestが変わるとstaleになり、frozen renderは失敗します。

本番renderでは検証済みlockのスナップショットを`dist/<project-id>/<lock-hash>/project.lock.json`にも保存します。このコピーはvideoやreportと同じ一時ディレクトリでmanifest対象にした後、ディレクトリ単位で公開されます。`inspect`はこの同梱lockを正本としてSchema、自己ハッシュ、manifest/reportのproject digestとlock hash、`totalFrames / fps`から求めた動画尺を検証するため、元の編集workspaceがなくても成果物を検査できます。

v0.1の`theme.fontFamily`は`Noto Sans CJK JP`だけを受け付けます。Dockerイメージが同梱するfontconfigの実体をresolve時に`runtime.font`へ記録し、render時に一致を検査します。VOICEVOXのcredit名は編集可能な`displayName`ではなく、resolve時にEngineのspeaker UUID/style IDから取得した話者名をlockへ固定します。

VOICEVOX音声は、テキスト、speaker UUID、style ID、速度、音量、pitch、intonation、Engine versionから作るcontent-addressed keyで`${CLAUDE_PLUGIN_DATA}/cache/voicevox/`へ保存します。同じ条件ならprojectをまたいで再利用し、resolve時に対象projectの`.json-video-work/<project-id>/voice/`へ固定します。
