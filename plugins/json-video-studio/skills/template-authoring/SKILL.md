---
name: template-authoring
description: JSON Video Studio v1の8種類の安全なvisualテンプレートとthemeを選び、再利用可能なscene JSONを設計・検証する。画面レイアウト、比較、コード、グラフ、引用、サムネイルのJSONを作りたい場合に使う。任意Reactや新visual typeの実装には使わない。
---

# JSON Video Studio template authoring

既存の8種類のvisualを組み合わせ、Schema準拠のsceneまたはprojectを作る。JSONから任意コードを実行できる拡張は行わない。

## 手順

1. `../create-video/references/visual-guidelines.md`と`../../schemas/video-project.schema.json`を読む。
2. 利用目的を次へ正規化する。
   - 導入/章扉 → `title`
   - 列挙 → `bullets`
   - 比較 → `split`
   - 画像/動画 → `media`
   - source/diff/terminal → `code`
   - 引用 → `quote`
   - 数値/棒/折れ線 → `metric`
   - まとめ/CTA → `outro`
3. 発話方式をユーザー音声、VOICEVOX、無音から1つ選び、sceneの条件付き必須項目を守る。
4. `theme`は背景、前景、accent、font familyのコントラストを保つ。サムネイル文言は1〜2行、各40文字以内にする。
5. snippet単体ではなく、一時的なvalid projectへ組み込んで`project_validate`する。
6. `storyboard_start`を実行し、少なくとも該当sceneとサムネイルを目視確認する。

## 出力形式

依頼がscene作成なら、説明の後に貼り付け可能なscene objectだけを返す。project全体の更新なら`project_get`でrevisionを取得し、`project_update`を使う。利用者の既存JSONを直接上書きしない。

## 禁止事項

- `visual.type`へ未知の値を追加しない。
- HTML、CSS、JavaScript、JSX、component path、shell commandを埋め込まない。
- remote URLや絶対パスをassetとして使わない。
- 引用の出典、数値、権利情報を捏造しない。
- Schemaを緩めてレイアウト問題を回避しない。

新しいvisual typeが必要な依頼はv0.1の対象外であることを説明し、必要なSchema、TypeScript union、renderer component、golden testの変更点だけを提案する。
