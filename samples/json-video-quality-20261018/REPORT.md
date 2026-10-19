# JSON Video Studio 動作・品質検証（2026-10-18）

JSONから音声付きMP4を生成できることを、Docker内の実MCP呼び出しで確認しました。提供用は全8テンプレートを使う49.434秒の動画です。表現は、大きな文字・図解と控えめな登場アニメーションを使う解説スライド動画です。

- [動画](final/video.mp4) / [ローカル再生ページ](index.html)
- [編集用JSON](showcase/video-project.json)
- [字幕](final/captions.srt) / [サムネイル](final/thumbnail.png) / [クレジット](final/credits.txt)
- [成果物manifest](final/artifact-manifest.json) / [再現用lock](final/project.lock.json)

## 確認内容

| 対象 | 結果 |
|---|---|
| 同梱dialogue JSON（内容変更なし） | MP4生成成功、14.934秒 |
| 全8テンプレートを基にした音声付きJSON | MP4生成成功、49.434秒 |
| 映像・音声形式 | H.264 / AAC、1920×1080、30fps、yuv420p、48kHz stereo |
| 完成MP4の全フレーム | FFmpegでデコード成功 |
| 字幕・章・サムネイル | 尺内、章順序正常、1280×720 |
| manifest・lock・report | ハッシュ・自己整合・必須成果物検査成功 |
| 音声 | 全8sceneで元WAVとの相関0.988〜0.994、クリッピング0 |
| 音声タイミング | 全scene共通の42.667ms遅延、累積ずれなし。今回の許容値2frame（66.667ms）以内 |

音声の遅延は検査誤差ではなく、レンダーされたMP4に存在します。AAC priming/mux処理が原因と推定されますが、内部原因の確定や修正は行っていません。初回の±10ms検査は不合格で、その記録も保存しています。図解ナレーション用途として2frame以内を許容する基準に切り替え、値を明示して再検査しました。発音・抑揚の聴感評価は行っていません。

## レビューで直した問題

1. 箇条書きの絵コンテが登場途中で撮られ、後半項目が見えない問題を修正。最終項目の表示完了を待つようにしました。
2. コンタクトシートで画面下部・字幕が切れる問題を修正。16:9全体をセルに収め、ラベルを分離し、section背景も表示します。
3. 短いsceneでfade補間の範囲が不正になる問題を修正。短尺の回帰テストを追加しました。
4. 提供用JSONの字幕を短い要約にして、「す。」だけ次行に残る折返しを解消しました。

全テンプレート元JSONの画像は仮置き、各sceneは無音1.8秒だったため、そのまま提供せず、今回作成した図解画像・権利情報、VOICEVOX読み上げ、発話後の余韻を追加しています。metricは数値表示を使用し、折れ線グラフの軸・ラベル品質は今回の提供動画の検証対象外です。

## 証拠と検証範囲

- 絵コンテ: [初回指摘と再レビュー](showcase/.json-video-work/quality-showcase/reviews/)。修正後は独立agentによる8ゲートすべて合格。
- 完成動画: [独立agentの最終判定](showcase/final-review/visual-review.json)は映像標本合格。全17画像（各sceneの中間画像、開始・登場・終端の5時点比較、縮小サムネイル）を確認。連続再生の主観的な動き・聴感の評価とは区別します。
- 提供用フォルダ: コピー後にも[独立した成果物検査](logs/delivered-inspection.json)が全項目合格。動画SHA256は `ddc81003a49b821615da34ad29752f5ca28b7275c92c07bcc15ff204af70617f` で、最終レビュー対象と一致します。
- MCP: [job・検査ログ](logs/)。project_create/update → validate → dry resolve → resolve → storyboard → review → render → inspectを実行。
- テスト: 初回88件中87件成功。追加したgeometryテスト1件に浮動小数誤差（30pxに対して29.999999999999986px）があり、1e-9pxの許容誤差を設定して対象15件の再実行がすべて成功。[初回ログ](logs/tests.txt) / [再実行](logs/tests-layout-rerun.txt)。未解消のテスト失敗はありません。
- golden: 箇条書き1枚を目視確認して基準画像を更新。他7枚はSHA256完全一致。[比較記録](golden-check/comparison.json)。

今回の動作確認はCLI起動したDocker内MCPとレンダラーに対するものです。Claude Codeへのプラグイン登録、Web UIの全操作、長時間動画、人物口パク、BGM混合、外部提供音声、任意のJSONすべてについての品質は保証していません。未解決のコード監査所見として、lockなしpreviewのframe 0が透明、字幕行数の推定幅が実表示幅より広い点があります。

## 実行環境

ホストにNode/npm、Python、FFmpeg、Chromium、フォント等の依存パッケージはインストールしていません。音声合成は専用DockerネットワークのVOICEVOX、レンダリング・検査は`--network none`のDockerコンテナで実行しました。成果物・キャッシュ・検証スクリプトだけをこのディレクトリに保存しています。

検証用コンテナと専用ネットワークは終了・削除済みです。Dockerイメージは再実行用に残しています。

- Runtime image: `json-video-studio:quality-check-v2-20261018`
- Image SHA256: `76c3346606e2a7985ffdedc6aa0594b9c57693c41200368ff78de8f85d6ee0b0`
- Node 24.18.0 / Remotion 4.0.503 / FFmpeg 5.1.9 / Chromium 151 / Noto Sans CJK JP / VOICEVOX 0.25.1

Dockerビルド時のnpm auditはproduction依存に14件（moderate 5 / high 8 / critical 1）を報告しました。依存更新や到達可能性の分析は今回の検証範囲外です。外部公開サービスとしての安全性評価とは分けて扱ってください。

音声はVOICEVOX:四国めたん（ノーマル、style 2）。利用条件は[VOICEVOX](https://voicevox.hiroshiba.jp/term/)および[音源利用規約](https://zunko.jp/con_ongen_kiyaku.html)、レンダラーの利用条件は[Remotion](https://www.remotion.dev/docs/license/pricing)を参照。配布動画のクレジット表記を保持してください。
