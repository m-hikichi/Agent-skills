# 読みレビューと動きによる解説の改善

今回の対処はJSONの置換だけではなく、**全台詞の生成された読みを別agentが文脈と照合し、誤読なら修正・再生成する工程**です。辞書は修正手段の一つです。

[改善動画（MP4）](final/video.mp4) / [再生ページ](index.html) / [工程アニメーションの抜粋](flow-preview.gif)

## 今後の誤読への対処

- `pronunciations`：同じ意味・読みで使う語の表記と発音を分離。英字だけでなく人名・地名・漢字語も指定可能。
- `speechText`：sceneごとの発話原稿。同じ「1日」でも日付と期間で読みを変えるなど、文脈依存の語を一律辞書置換しない。
- 合成に使った原稿とVOICEVOXの実際の生成かなを音声cacheとlockへ保存。
- 独立した読みreviewerが**登録語だけでなく全文**を確認。略語、外来語、固有名詞、同形異音語、数値、日付、助数詞、単位、熟語、文の区切りを対象にする。
- 各音声の全文確認・WAV hash一致・現lock一致・未解決の読み0件が本番renderの条件。未確認・古い確認・辞書語だけの部分確認では止まる。
- 誤読は読み指定または発話原稿を直して再resolve→再レビュー。利用者しか知らない固有名詞の読みは推測でpassにしない。

自動warningは大文字英略語に対する限定的な補助です。warningが0件でも全文レビューを省略しません。あらゆる未知語の発音を機械的に保証するものではありません。

## 動きによる解説

新しい`flow` visualは、同じ図の中で「入力→移動→到着→次工程」の関係を描きます。発話sceneごとに`activeStep`を進め、データの移動、接続線の伸長、工程の完了・処理中・待機を対応させています。図自体はscene境界でfadeせず、連続した処理として見せます。

サンプルは導入・読みの説明・4工程・まとめの7sceneです。従来の全テンプレート紹介を繰り返すのでなく、原稿が動画になる流れを説明します。

今回の動きは工程間の進行を説明する範囲です。音声の尺に字幕を合わせる操作など、各工程内部の処理そのものの動的図解は含みません。

## 確認した証拠

- [元のJSON](demo/video-project.json)
- [全台詞の読みレビュー](demo/.json-video-work/json-motion-demo/narration-review.json)
- [絵コンテレビュー](demo/.json-video-work/json-motion-demo/review.json)
- [完成動画の独立映像レビュー](demo/final-review/visual-review.json)
- [完成動画の音声・映像検査](demo/final-review/media-check-v2.json)
- [配布物の整合性検査](logs/demo-inspection.json)
- [修正前後のVOICEVOX生成かな比較](logs/pronunciation-comparison.json)
- [全体100テスト成功](logs/tests-all.txt)
- [一般語・文脈依存読みと全文ゲートの追加/変更分9テスト成功](logs/tests-general-readings.txt)

今回の7台詞は全語を生成かなと照合しました。例えばJSONは英字列の「ジェエエスオオエヌ」から「ジェエソン」に変わり、台詞=セリフ、一本=イッポンも確認しています。音声WAVのSHA256は全件lockと一致します。

完成動画は49.467秒、1920×1080、30fps、H.264/AAC。全フレームのデコードと配布物の整合性検査が成功しました。全7音声と完成動画の波形相関は0.9896〜0.9928、クリッピングは0です。音声には一定の約42.667ms（約1.28フレーム）の遅延が残りますが、累積ずれはありません。

独立レビューでは全7場面の中点・時系列画像と縮小サムネイルの計15画像を確認し、文字切れ・重なり・工程と台詞の不整合はありませんでした。これは抽出画像による確認であり、リアルタイム全編視聴ではありません。

完成MP4のSHA256：`8709ae9c8355729bb396cdbf37b4dbe2db6dfd6c9675c7367e258f8810322b13`

**聴感評価は未実施です。** 生成かなの照合は読みの確認に使えますが、自然な抑揚や実際の聴こえ方まで確認したことにはしません。聴ける環境では追加で聴感レビューし、記録上も区別する仕組みにしています。

## 環境と再利用

ホストへの依存パッケージ追加なし。VOICEVOX、Chromium、Remotion、FFmpegはDocker内で実行。renderは`--network none`です。

検証専用の音声合成コンテナとネットワークは終了後に削除済みです。再現用Dockerイメージは保持しています。

検証runtime imageは`json-video-studio:motion-v2-20261018`。既存の既定タグや個人用プラグイン配置は変更していません。今後プラグインで使う場合は、リポジトリのREADMEに従って再build・更新してください。

同梱サンプルは`plugins/json-video-studio/examples/animated-flow.video-project.json`、読みreviewerは`plugins/json-video-studio/agents/narration-reviewer.md`。新フィールドとレビュー手順はSchema・README・create-videoスキルへ反映しています。

音声クレジット：VOICEVOX:四国めたん
