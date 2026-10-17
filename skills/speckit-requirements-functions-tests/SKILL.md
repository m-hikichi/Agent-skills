---
name: speckit-requirements-functions-tests
description: >-
  GitHub Spec Kit v1.0.x の feature ディレクトリまたは spec.md から、要件定義書、要件に紐づく
  機能一覧、機能に基づくテスト一覧、統合レビューHTMLを生成・更新し、REQ→FNC→TSTの追跡性を
  検査する。User Story、Acceptance Scenario、Functional Requirement、Edge Case、Success Criteriaを
  レビュー可能な文書へ変換したいとき、「要件定義書を作って」「機能一覧へ落として」「テスト項目を
  洗い出して」「Spec Kit成果物をQAへ渡したい」「要件変更の影響を更新して」などで使う。
  実装コードの生成、テスト実行、タスク見積り、Excel作成だけが目的の依頼には使わない。
---

# Spec Kit成果物から要件・機能・テスト文書を作る

## 正本と成果物

このスキルでは、Spec Kit v1.0.x の成果物を入力資料、次の JSON を派生成果物の唯一の正本とする。

- `<feature>_requirements-functions-tests.json`

JSONから次を決定的に生成する。MarkdownやHTMLを直接編集せず、変更時は入力成果物とJSONを更新して
再生成する。

- `<feature>_要件定義書.md`
- `<feature>_機能一覧.md`
- `<feature>_テスト一覧.md`
- `<feature>_レビュー.html`

JSON構造、ID、リンク、文書列、品質ゲートの詳細は、作業前に
[`references/format_spec.md`](references/format_spec.md)を全文読む。

## 1. 入力とモードを決める

featureディレクトリを標準入力とし、`spec.md`を必須にする。単一の`spec.md`が指定された場合は、
その親をfeatureディレクトリとして扱う。

- `spec-only`: `spec.md`だけから要件、機能、論理的な受入テストを作る。
- `plan-enriched`: `plan.md`、`research.md`、`data-model.md`、`quickstart.md`、必要な`contracts/`を
  読み、契約・統合・状態・非機能テストを追加する。
- `auto`: plan系成果物が揃い、内容を根拠として利用できる場合だけ`plan-enriched`にする。それ以外は
  `spec-only`にし、不足を推測で補わない。

`tasks.md`は実装計画の参照資料であり、要件やテスト結果の正本ではない。`checklists/`は要件品質を
確認する補助資料であり、チェック済みでもテスト合格とはみなさない。未知の追加成果物は自動解釈せず、
`--extra-artifacts`のmanifestに役割が明記されたものだけ読む。

## 2. Spec Kit v1.0.x の意味を保って抽出する

固定された日本語・英語の見出し名だけに依存しない。Markdown構造、明示ID、User Storyの構成、
受入シナリオのGiven/When/Then、成果物の役割を併用し、PresetやExtensionによる見出し変更に耐える。
少なくとも次を抽出する。

- User Story本文、優先度、Why、Independent Test
- Acceptance Scenario、Functional Requirement、Edge Case
- Success Criteria、Assumption、Clarification、Out of Scope
- plan-enriched時のデータ、状態、契約、技術制約、NFR、quickstartの確認条件

解釈できない節は捨てずにトップレベルの`unclassified`へ原文位置付きで保持し、警告する。入力ファイルは
相対`path`、`locator`、`sha256`、`authority`を記録し、古い入力に基づくJSONを検出できるようにする。

## 3. REQ→FNC→TSTを組み立てる

要件は入力の`FR-xxx`や`SC-xxx`等の明示IDを保持し、未付番要素だけ種別に応じた`US/AC/EC/ASM/OOS/CL/REQ`
prefixで生成する。業務上独立して説明・受入確認できる機能には`FNC-xxx`、検証可能なテスト項目には
`TST-xxx`を付ける。既存`identity_registry`のentry配列を使って生成IDを維持し、retired IDを再利用しない。

`links`の`type/from_id/to_id`を関係の唯一の正本とし、次を成立させる。

- 現行のUser Story、Acceptance Scenario、機能・非機能要件、Edge Case、Success Criteriaは
  1件以上のFNCに結びつく。
- 現行FNCは1件以上のREQを根拠にし、1件以上のTSTで検証される。
- TSTは対象FNCと、その上流REQへ逆引きできる。
- 将来・対象外・廃止要素を現行要素としてcoverageへ数えない。

機能は「入力・保存・表示」のような実装工程ではなく、業務責務、独立した判断、状態遷移、失敗境界で
分ける。要件ごとに機能を作らない。User Storyまたは独立した業務上の振る舞いを機能の骨格とし、
Acceptance Scenario、FR、Edge Case、Success Criteria、NFRは、その振る舞いを成立させる条件として
同じ機能へまとめる。複数機能へ共通する横断要件は1件のREQから複数FNCへリンクし、対応範囲が曖昧なら
確認事項として残す。1件の要件文をそのまま1機能にした候補は機能境界の警告対象とし、レビューで
`basis: confirmed`になるまでpublishを許可しない。

User Storyがない入力では、`[機能: 注文登録]` / `[Capability: Order registration]`の共通ラベルや
`同一機能: FR-001` / `same function as FR-001`という明示的な関係を機能集約の根拠にできる。
根拠がなければ候補を分けて確認事項に残す。「登録」「作成」という動詞が同じだけで別業務を統合しない。
候補を作っただけで工程を終えず、担当エージェントが原文の業務責務を読んで統合・分割を確定する。

テストは検証する条件・操作・期待結果の組合せごとに作る。1要件に正常・異常・境界など複数のTSTを
対応させてよい。初期generateは要件ごとの候補を作るだけなので、入力に示された分岐や境界を読んで
追加・分割する。同じ試験を対象機能数だけ複製せず、複数機能をまたぐ結合テストは同じTSTへリンクする。
テストの各要件は対象機能のいずれかの上流要件であり、各対象機能にはそのテストが検証する要件が必要。
`type`、`level`、`preconditions`、`steps`、`expected_result`、`automation_status`を持ち、
操作と期待結果を観測可能に書く。Acceptance Scenario、Edge Case、Success CriteriaをTSTへ反映する。
複数のGiven/When/Thenが明示されている要件は条件ごとに展開する。plan系資料では複数行のGWT、
明示要件付きの状態遷移表、契約のRequest/Response記述も扱う。対応書式はformat_specの5.4を参照する。
通常のOpenAPI/YAMLや自由記述を読めない場合は原文を保持し、エージェントが根拠を照合して補完する。

## 4. 根拠のない情報を作らない

入力にない数値、期限、既定値、権限、エラー挙動、API path、型、状態、性能閾値、テストツール、
自動化可否を一般論から確定しない。正本にない項目は`unspecified`として根拠と影響を記録し、必要なら
`open_questions`へ送る。

- 要求・業務判断の不足は`/speckit.clarify`へ戻す。
- 技術構成・契約・運用設計の不足は`/speckit.plan`へ戻す。
- 成果物間の矛盾は`/speckit.analyze`へ戻す。

期待結果は観測でき、かつ入力から裏付けられる範囲で書く。根拠がない具体値を「妥当な例」として
混入させない。曖昧な要素の自動再結合や、質問への回答を入力正本へ反映せずJSONだけで解決することも
避ける。

## 5. 品質プロファイルを適用する

付属generateは初期draftを作る補助であり、自然言語の意味を完全に判定する変換器ではない。
明示IDとGiven/When/Then以外の契約・状態・測定手順の対応は、原文を読み直してエージェントがJSONへ
補う。`unclassified`の原文を失わず、根拠のない対応を確定するために質問を閉じない。
自動生成後は、別エージェントに入力原文とJSONを渡し、抽出漏れ、機能境界、直接REQ→TSTの妥当性、
期待結果の根拠をレビューさせる。指摘を修正して再レビューし、重要指摘がなくなるまで繰り返す。
別エージェントが使えない環境では、その旨を明示し利用者レビューを求める。
レビュー完了した質問だけ`status: resolved`にし、`resolution`に判断理由、`source_refs`に原文位置を残す。
意味レビューの質問は削除せず、担当者またはエージェントと確認範囲もresolutionに記録する。
業務上の未決は勝手に解決しない。機能境界の確認が済んだ機能は`basis: confirmed`にし、rationaleを根拠付きで更新する。
質問を解決済みにしただけでは公開可能にしない。レビュー担当者は編集完了後の正本を読み、
`review_documents.py digest`で確認対象の版を取得する。独立レビューが完了した版についてのみ
`review_documents.py record`で担当者と確認範囲を記録する。記録コマンド自体はレビューを実施しない。
作成担当が未実施のレビューを代行記録したり、チェックを通す目的でdigestを更新したりしない。
要件・機能・テスト・関連・根拠・判断を編集すると記録が失効するため、変更内容を再レビューする。
旧JSONの解決済み質問だけではこの版のレビュー記録にならず、初回は再確認が必要である。
checkの成功は構造・追跡性・再現性の検査結果であり、意味の正しさやテスト実施済みを保証しない。

- `draft`: 未決事項と警告を表示したまま文書を生成できる。レビューと追加clarificationに使う。
- `publish`: stale入力、未解決のレビュー・現行要件、孤立REQ/FNC/TST、リンク不整合、測定不能なSuccess
  Criteria、未確認の機能境界、テストの事前条件・操作・データ・期待結果の不足があればnon-zeroで拒否する。
  データや事前条件が本当に不要なら空欄でなく不要な理由を書く。根拠のない期待結果は原文との意味レビューで検出して修正する。

「適切なデータ」「正しく動作する」だけでは実施・判定できないので、入力値またはfixture参照と
観測対象・結果を具体化する。「画面に『未設定』と表示」のような仕様上の文字列は引用で表し、
未記入の状態と区別する。既知の曖昧表現検査は補助であり、レビュー時には各テストを第三者が
同じ手順・同じ判定で実施できるかを原文に照らして確認する。

次の6軸を個別に判定し、単一の総合フラグで問題を隠さない。

1. `source_integrity`
2. `requirements_quality`
3. `function_coverage`
4. `test_coverage`
5. `cross_artifact_consistency`
6. `render_reproducibility`

## 6. 生成・更新・検査する

新規生成と入力変更の反映にはgenerate、既存JSONからの再生成にはrender、公開可否の検査にはcheckを使う。

```bash
python <skill>/scripts/generate_documents.py <feature-or-spec> \
  --output-dir <dir> --mode auto --profile draft

python <skill>/scripts/render_documents.py \
  <feature>_requirements-functions-tests.json --output-dir <dir> --feature-dir <feature-dir>

# 編集が完了したレビュー対象版を取得し、その版を独立レビューする
python <skill>/scripts/review_documents.py digest \
  <feature>_requirements-functions-tests.json --feature-dir <feature-dir>

# 独立レビューを実施した担当者が、確認した版と判断を記録する
python <skill>/scripts/review_documents.py record \
  <feature>_requirements-functions-tests.json --feature-dir <feature-dir> \
  --expected-digest <確認した版のdigest> --reviewer <担当者名> --summary <確認範囲と判断>

python <skill>/scripts/check_documents.py <feature-or-spec> \
  <feature>_requirements-functions-tests.json --output-dir <dir> --profile publish
```

追加成果物が必要な場合だけgenerateへ`--extra-artifacts manifest.json`を渡す。生成後、意味レビューとJSONの
補完・レビュー記録を行い、render、checkを実行する。record後は表示内容が変わるのでrenderを再実行する。
publish依頼で未決が残る場合はdraftと診断を提出し、公開可能と称さない。
JSONから再計算した3 MarkdownとHTMLが提出物とバイト一致することを確認する。同じ正本から生成時刻や
環境依存値が混入して差分が出ないようにする。

更新時は入力差分を先に確認し、既存のREQ/FNC/TST IDと順序を可能な限り維持する。削除要素は黙って
消さずretiredとして変更影響へ残す。曖昧な同一性は確認事項としてブロックし、推測でIDを移さない。

入力とモードが同じならgenerateは既存JSONの内容・リンク・レビュー判断を保持して再検査する。
未編集の自動生成draftは入力変更を反映できる。レビュー修正があるJSON（または旧版で編集検出情報がないJSON）
と入力変更が重なった場合、generateは上書きせず停止する。`generation_digest`は編集検出用なので手で更新しない。
この場合は同じgenerateコマンドに`--update-proposal --profile draft`を付け、別名の更新案を作る。
元の5成果物は変更しない。既存更新案も上書きしない。

`python <skill>/scripts/compare_documents.py <旧JSON> <更新案JSON> --output <比較.md>`で、
要件・機能・テスト・関連・根拠資料の変更と引き継がれていない解決済み判断を一覧化する。
比較結果は全変更フィールドを保持し、どちらの正本も変更しない。既存比較ファイルは上書きしない。

更新案と旧JSONを比較し、機能の統合・分割、追加テスト、リンク、判断理由を更新案へ引き継ぐ。古い根拠行番号や
解決済み判断を無条件に移さず、変更した原文に照らして再レビューする。`update-review`と`semantic-review`の
質問はこの確認後に理由付きで解決し、render/checkを実行する。更新案を新正本として採用する際は旧正本を
gitまたは別名で保管してから置き換える。安全な自動マージではなく、明示的な比較レビューの工程である。

## 7. レビュー成果物を確認する

3つのMarkdownはそれぞれ単独でレビュー可能にし、各行から関連IDと入力根拠を辿れるようにする。
HTMLは「概要・要件・機能・テスト・トレーサビリティ・未決／変更影響」の6ビューを持つ自己完結表示とし、
キーボード操作、ARIA、表見出し、印刷表示を備える。表内の関連REQ/FNC/TST IDは、クリックで該当項目へ
移動できるだけでなく、マウスホバーまたはキーボードフォーカスで名称・概要・期待結果をその場で確認できる
プレビューを付ける。プレビューは表のスクロール領域で切れず、HTML特殊文字を必ずエスケープする。

JSONのenumは機械処理の安定性のため英語で保持するが、人が読むMarkdownとHTMLには日本語の名称と説明を
表示する。たとえば`acceptance-scenario`は「受入条件」、`current`は「今回の対象」、`unspecified`は
「未設定（要確認）」とする。略語や内部値を表にそのまま出さず、冒頭に「この文書の見方」を置く。

各資料を単独で渡しても判断できるよう、冒頭に「この資料で分かること」「現在の確認状況」「次にすること」を
置く。自動生成した機能境界は意味レビューが済むまで「候補」、操作・事前条件・期待結果が不足するテストは
「要具体化」と表示し、完成した仕様に見せない。品質軸にwarningがあれば「問題なし」ではなく「確認推奨」と
表示する。内部の戻り先名、生JSON、空配列、SHAは本文へ展開せず、利用者向けの行動説明または折り畳んだ
技術情報へ移す。

最終報告では次を簡潔に示す。

- 入力モードと品質プロファイル
- 生成した5成果物
- REQ/FNC/TST件数とcoverage
- 6軸の判定
- 未決事項、警告、publishを妨げる問題

旧基本設計v3、旧10ビューHTML、旧CLI、旧JSONからの移行はサポートしない。旧成果物を検出した場合は
新しいcanonical JSONを入力成果物から生成し直す。
