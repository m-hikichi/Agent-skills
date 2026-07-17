# Quality assurance and review

品質はMarkdown、機械検査、contact sheet、ページ画像、内容の5つを別々に確認する。

## Render iteration

`render 1` は発見用でありfinalize不可。全ページ2倍PNGとcontact sheetを作り、少なくとも1件の改善を行って `render 2+` を作る。再レンダー前に、次のiteration番号の改善entryを `render-manifest.json` へ追記する。「余白調整」のような曖昧な表現でなく、ページ、観測、変更、意図を書く。

## Machine QA

- source、theme、request、asset manifest、参照／登録された全ローカルassetのfingerprint
- Markdownのスライド数とPNG数の一致
- PNGの実在、SHA-256、寸法、連番
- 欠損asset、外部参照、path traversal
- overflow、clip、重なりの兆候
- 発表形態に対する最小文字、行間
- 文字と背景のcontrast
- informative imageのalt、decorative指定

機械QAの正本はレンダラーが出力する `.slide-work/machine-qa.json`。手作業でpassへ変更しない。geometry検査が`not_run`なら統合reviewもpassにしない。機械QAは意味や美しさを判定しないため、passしても人のレビューを省略しない。

統合時はraw reportを次のrubric v3 keyへ機械的に写す。`status`は元checkと同じ値にし、`evidence`には件数と該当slide/pathを残す。`overflow_and_clipping`は同じ測定結果をkind別に分け、片方だけ問題がなくてもraw check全体を一律passへ書き換えない。

| rubric v3 | `.slide-work/machine-qa.json` |
|---|---|
| `asset_integrity` | `missing_assets` |
| `overflow` | `overflow_and_clipping.violations[kind=overflow]` |
| `clipping` | `overflow_and_clipping.violations[kind=clipping]` |
| `slide_count` | `page_count` |
| `minimum_text_size` | `minimum_text_size` |
| `contrast` | `contrast` |
| `alt_text` | `informative_image_alt` |
| `manifest_integrity` | `manifest_integrity` |

`accessibility_target: standard`でもmeaningful alt、十分なcontrast、色以外の識別、会場で読める文字サイズを必須にする。`enhanced`では、より保守的な文字サイズとcontrast、chartの直接ラベル、読み順、略語の展開までvisual reviewerが確認する。

## Content review

content reviewerは原稿、request、storyboard、deck plan、根拠資料を確認する。

- audience/goal fit
- action titleだけで通る論理
- must-include coverage
- 事実、解釈、仮説、提案の区別
- 数値・引用の出典、期間、単位、母数
- 結論を支える根拠、反論、限界
- live/hybrid notesの有用性

見た目の好みで内容判定を変えない。

## Visual review

最初にcontact sheetで次を見る。

- デッキ全体のリズムとセクション遷移
- 同一構図、カード、色、密度の反復
- titleとvisualが作る論理の流れ
- 写真、図、chart、表、文字中心ページの配分

次に2倍PNGを1枚ずつ開き、切れ、重なり、孤立改行、低contrast、読めないsource、crop、chart尺度、注釈、意味のあるaltとの一致を確認する。ファイルの存在確認だけで`visual_review.status: pass`にせず、`checked_page_count`と`page_images`を実際に開いた全ページと一致させる。

## Severityと判定

- critical: 誤判断、虚偽、読めないページ、重大な尺度誤認
- major: 目的達成を明確に損ね、公開前に修正が必要
- minor: 使用は妨げないが、具体的な改善価値がある

rubric v3 passには全hard gate pass、全score 4以上、critical/majorなしが必要。`needs_user`は要求不足、`blocked`はrenderやアクセス不能だけに使う。

## Fingerprint discipline

reviewはsource Markdownだけでなく、request、theme、asset manifest、参照／登録された全ローカルassetを含むfingerprintに結び付ける。renderer条件はrender manifestへversionとfont hashとして記録し、環境が変わったらvisual regressionを行う。pass後にfingerprint対象を1つでも変更したら古いreviewを無効化し、再レンダー・再レビューする。
