# 要件・機能・テスト文書 — canonical JSON・投影仕様

## 目次

1. [互換範囲と成果物](#1-互換範囲と成果物)
2. [入力とモード](#2-入力とモード)
3. [canonical JSON](#3-canonical-json)
4. [IDと変更管理](#4-idと変更管理)
5. [要件・機能・テスト](#5-要件機能テスト)
6. [リンクとcoverage](#6-リンクとcoverage)
7. [派生文書](#7-派生文書)
8. [品質ゲート](#8-品質ゲート)
9. [CLIと終了コード](#9-cliと終了コード)

## 1. 互換範囲と成果物

対象はGitHub Spec Kit `1.0.x`のfeature成果物である。canonical JSONの`schema_version: 1`はこのスキルの
スキーマ版であり、Spec Kit版は`speckit_compatibility`と`tested_versions`で別に管理する。

標準成果物は次の5ファイルである。

| 種別 | ファイル | 役割 |
|---|---|---|
| 正本 | `<name>_requirements-functions-tests.json` | 抽出値、生成ID、関係、診断の唯一の正本 |
| 投影 | `<name>_要件定義書.md` | 要件レビュー |
| 投影 | `<name>_機能一覧.md` | 要件に紐づく機能レビュー |
| 投影 | `<name>_テスト一覧.md` | 機能に基づく試験項目レビュー |
| 投影 | `<name>_レビュー.html` | 3文書を横断する統合レビュー |

`<name>`は既定でfeatureディレクトリ名、render/checkではcanonical JSON名から導出する。`--name`で変更でき、
Windows予約名やファイル名に使えない文字は安全なstemへ正規化される。

旧基本設計v3のJSON、10ビューHTML、旧CLI、移行コマンドとの互換性は持たない。

## 2. 入力とモード

featureディレクトリまたは名前が`spec.md`のファイルを受け取る。`spec.md`は必須で、単一ファイル入力時は
親ディレクトリをfeatureとして扱う。

| モード | 実装上の選択 |
|---|---|
| `spec-only` | specから要件、機能、論理受入テストを生成する |
| `plan-enriched` | plan系成果物を根拠に契約・状態・E2E・NFR等のテストを追加する |
| `auto` | `plan.md`、`research.md`、`data-model.md`、`quickstart.md`が全てあれば`plan-enriched`、それ以外は`spec-only` |

標準探索対象は`spec.md`、`plan.md`、`research.md`、`data-model.md`、`quickstart.md`、`tasks.md`、
`contracts/`配下の全ファイル、`checklists/`配下のMarkdownである。

- `tasks.md`はevidenceとして記録するが、要件、試験項目、実行結果の正本にはしない。
- checklistはquality sourceとして記録する。未チェック項目はdraftでwarning、publishでerrorになる。
- quickstartの番号付き手順は実施結果ではなく、plan-enriched時のE2Eテスト根拠として扱う。
- 未知の追加成果物を既知要件へ自動変換せず、トップレベル`unclassified`へ保持する。

追加成果物manifestは`extra_artifacts`または`artifacts`配列を受け取る。

```json
{
  "extra_artifacts": [
    {
      "path": "extensions/security.md",
      "type": "security-extension",
      "locator": "*",
      "authority": "evidence"
    }
  ]
}
```

`authority`は`normative|design|evidence|quality`のいずれかである。`role: supplemental`だけは
`authority: evidence`へ補完される。pathはfeature配下の実在ファイルでなければならない。

## 3. canonical JSON

トップレベルの実体は次の形である。

```json
{
  "schema_version": 1,
  "speckit_compatibility": "1.0.x",
  "tested_versions": [],
  "title": "注文連携",
  "mode": "spec-only",
  "profile": "draft",
  "sources": [],
  "identity_registry": [],
  "context": {},
  "requirements": [],
  "functions": [],
  "test_cases": [],
  "links": [],
  "unclassified": [],
  "open_questions": [],
  "change_impact": [],
  "report": {}
}
```

`title`、`mode`、`profile`はトップレベルに置く。`feature`objectや`generation`objectは使わない。
`unclassified`も`context`内ではなくトップレベルへ置く。`context`の現在の主要項目は`title`、`overview`、
`key_entities`である。JSONはUTF-8、2空白indent、keyの辞書順、LF、末尾改行ありで出力する。

### 3.1 sources

```json
{
  "type": "spec",
  "path": "spec.md",
  "locator": "*",
  "sha256": "<64桁のSHA-256>",
  "authority": "normative"
}
```

標準sourceのauthorityは、specが`normative`、plan/research/data-modelとcontractが`design`、
quickstart/tasksが`evidence`、checklistが`quality`である。追加成果物には`explicit: true`も付く。
checkはfeature相対pathの実在性と`sha256`を照合し、欠落または不一致をstale sourceとして拒否する。

## 4. IDと変更管理

### レビュー対象版

省略可能な`review_record`は`algorithm: sha256-canonical-v1`、`reviewed_digest`、`reviewer`、`summary`を持つ。
digestはトップレベルの`report/profile/generation_digest/review_record`を除いた全データを、キー順の
UTF-8 JSON（区切りは`,`と`:`、ensure_ascii=false）にしてSHA-256で計算する。リスト順も対象である。
これにより要件・機能・テスト・関連・根拠資料・質問と解決理由の編集を検出する。
review_recordの欠落・不完全・不一致はdraft警告、publishエラーで、画面もレビュー待ちに戻す。
旧解決済み質問を自動で新しい記録へ昇格しない。レポート再計算・profile切替・JSONのキー順変更は失効させない。
記録は署名やレビュー内容の正しさの証明ではなく、実際に確認した版との一致を検査するためのもの。

`review_documents.py digest <canonical> --feature-dir <feature>`で版を取得する。
独立レビュー後に`record <canonical> --feature-dir <feature> --expected-digest <digest> --reviewer <担当者> --summary <判断>`を実行する。
recordは版の一致、入力根拠、publish品質を検査し、未解決・未具体化の項目を勝手に解決せず拒否する。
成功時だけreview_recordとreportを正本へ保存する。record後にrender/checkを実行する。
実施していないレビューの記録・失効を無視した再スタンプは禁止する。

`generation_digest`（省略可能なSHA-256文字列）はgenerate直後の編集対象データの指紋で、再生成時に
編集の有無を検出する。公開承認・意味レビューの証明ではなく、利用者やレビュー担当者は再計算しない。
同じ入力・モードでは既存JSONを保持し、reportとprofileだけ再評価する。入力変更時、未編集draftだけを
自動更新する。編集済みまたは旧版で指紋のない正本は上書きを止め、`--update-proposal`で別名の更新案を作る。
更新案では旧ID登録簿を引き継ぐが、旧機能境界や具体化したテストは自動転記しない。元正本と比較し、
必要な編集・追加テスト・判断を引き継いで再レビューする。既存正本と既存更新案を黙って上書きしない。

### 4.1 要件ID

入力に明示されたIDは保持する。たとえば`FR-001`、`SC-001`は`REQ-xxx`へ変換しない。未付番要素には
種類に応じて`US`、`AC`、`EC`、`ASM`、`OOS`、`CL`、または汎用`REQ` prefixを付ける。

機能は`FNC-xxx`、テストは`TST-xxx`を単調採番する。全要件・機能・テストのIDはグローバルに一意で
なければならない。

### 4.2 identity_registry

registryはobjectではなくentryの配列である。

```json
[
  {
    "id": "FNC-001",
    "kind": "function",
    "source_key": "story:US-001",
    "lifecycle": "active",
    "aliases": []
  }
]
```

`kind`は`requirement|function|test-case`、`lifecycle`は`active|retired`。`id`と
`(kind, source_key)`はそれぞれ一意である。更新時は既存registryのsource keyで生成IDを再利用する。
activeエントリのID・kindは正本内の全要件・機能・テストと一致させる。手動追加時も登録が必要であり、
削除・統合した項目の登録はretiredにする。登録漏れや残存したactiveエントリは機械検査で拒否する。
旧entryが新モデルに現れなければ`lifecycle: retired`で保持し、retired IDは新規採番へ再利用しない。

未付番要件の削除と追加を同時に検出した場合、rename/moveか別要素かを決めつけず`open_questions`へ
`identity-review`を追加する。削除要件は`change_impact`へ次の形で記録する。

```json
{
  "id": "REQ-003",
  "change": "retired",
  "source_key": "<kind:sha256>",
  "impact": "対応する機能・テストの再確認が必要"
}
```

## 5. 要件・機能・テスト

### 5.1 requirements

```json
{
  "id": "FR-004",
  "kind": "functional-requirement",
  "statement": "同じ外部注文IDの注文を重複登録しない",
  "status": "current",
  "priority": "unspecified",
  "parent_id": "US-001",
  "basis": "specified",
  "source_refs": ["spec.md#L42"]
}
```

`kind`は`user-story|acceptance-scenario|functional-requirement|non-functional-requirement|edge-case|
success-criterion|assumption|clarification|out-of-scope|other`。`status`は
`current|future|out-of-scope|retired|blocked`、`basis`は`specified|derived|confirmed`である。
User Storyには`why`と`independent_test`が加わることがある。根拠位置は`path#L<line>`形式を使う。
User Storyの説明本文は`body`に保持する。`tested_versions`は公式版でエージェントコマンドによる成果物生成から
本スキルでの文書化まで一連の動作を検証した版だけを記録する。付属fixtureは合成例である。
2026-09-23には公式v1.0.0（commit `bca679051abb80d6cf0cd909f2539a28a10eb7eb`）のCLI初期化、
feature作成、公式テンプレートへ手作業で記入したspecからのdraft生成・検査を確認した。ただしこれは
CLI・テンプレート形式の限定検証であり、エージェントコマンド一連の検証ではないため`tested_versions`は空のままにする。
公式release: https://github.com/github/spec-kit/releases/tag/v1.0.0

### 5.2 functions

```json
{
  "id": "FNC-002",
  "name": "注文受付",
  "summary": "注文受付を独立して提供する",
  "status": "current",
  "priority": "P1",
  "actors": [],
  "trigger": "unspecified",
  "inputs": [],
  "outputs": [],
  "preconditions": [],
  "postconditions": [],
  "business_rules": [],
  "exceptions": [],
  "basis": "derived",
  "rationale": "独立して受入確認できるUser Storyを機能境界とした",
  "source_refs": ["spec.md#L8"]
}
```

機能は独立して受入確認できるUser Storyまたは業務上の振る舞いから導出する。要件数と機能数を
1対1に揃えない。Acceptance Scenario、FR、Edge Case、Success Criteria、NFRは原則として対応する
機能の条件・規則・例外・達成基準として集約する。横断要件は複数FNCへリンクできる。
既存機能へ根拠付きで対応できないFRだけを暫定的な独立機能候補にできるが、単一要件文と同じ名称の
`basis: derived`機能はpublish前に機能境界をレビューし、妥当なら`basis: confirmed`とする。
`basis: derived`には`rationale`が必要である。
名称や要件件数によらず、現行の`basis: derived`機能はpublishを拒否する。機能境界の意味レビュー後、
`basis: confirmed`と根拠付きrationaleで確定する。単語の類似による自動関連付けは候補でしかない。

### 5.3 test_cases

```json
{
  "id": "TST-006",
  "title": "注文受付 — AC-001",
  "type": "positive",
  "level": "logical-acceptance",
  "status": "planned",
  "priority": "P1",
  "preconditions": [],
  "steps": ["有効な注文を登録する"],
  "test_data": [],
  "expected_result": "注文が受け付けられる",
  "automation_status": "unspecified",
  "basis": "derived",
  "rationale": "AC-001を機能単位で検証するため",
  "source_refs": ["spec.md#L18"]
}
```

`type`は`positive|alternative|negative|boundary|nfr|contract|state|normal`。`level`は
`logical-acceptance|unit|integration|contract|e2e|performance|security|operational|manual-review`。
操作は`steps`配列、自動化状態は`automation_status`に置く。対応FNC/REQはtest objectへ重複保持せず、
`links`から導出する。`steps`と`expected_result`は必須で、実行結果は生成しない。
1要件1テストは初期候補の生成規則にすぎず、最終仕様の制約ではない。分岐、権限、境界、状態ごとに
複数のテストへ分割できる。追加TSTには一意のIDとidentity_registryエントリ、原文根拠を与える。
事前条件・手順・テストデータ・期待結果の不足判定はHTMLとpublish検査で共通化する。
`unspecified`、空白、TBD等の未確定値は具体化済みと扱わない。不要な項目には理由を明記する。
実際の表示・入力文字列は「未設定」や`TBD`のように引用し、操作・観測対象を引用外に書く。
引用だけの未確定語や引用外の未確定事項は拒否する。既知の曖昧な定型句（「適切なデータ」「正しく動作する」等）
だけのフィールドも不足とする。ただし任意の自然言語を機械だけで判定できるわけではなく、原文との意味レビューを要する。

### 5.4 明示根拠からの追加候補生成

specの受入条件は、受入見出しまたは太字の受入マーカー配下の番号付き・箇条書き項目から抽出する。
インデントされた継続行とGiven/When/Thenの継続行を同じ項目にまとめ、根拠位置は項目の開始行を保持する。
太字のWhen/Thenは節の終了として扱わない。旧版の抽出漏れを含む正本は同一入力再生成でも保持されるため、
修正版を別出力先へ生成して比較し、補完済み正本へ無条件に上書きしない。

User Storyなしでも、同じ`[Capability: 名称]` / `[機能: 名称]`ラベル、または既出要件への
`same function as FR-001` / `same capability as FR-001` / `同一機能: FR-001`という宣言を集約根拠にできる。
ラベルのない要件は勝手に統合せず、候補と機能境界の確認事項を作る。汎用動詞の一致は集約の根拠にしない。

1要件に複数の明示Given/When/Thenがあれば条件別のテスト候補を生成する。plan系資料では次を扱う。

- 要件IDを同じシナリオ、節見出し、または`Requirements: FR-001` / `要件: FR-001`に記載したGWT。同じ段落内で行を分けてもよい。
- `Requirement | From | Event | To | Test data`の状態遷移表。日本語列は`要件 | 遷移元 | 操作 | 遷移先 | テストデータ`等に対応する。
- contracts配下の同一段落にある`Request:`と`Response:`。`Preconditions:`と`Test Data:`を併記できる。
  日本語の`リクエスト:`、`レスポンス:`、`事前条件:`、`テストデータ:`にも対応する。

例えば次の明示記述は、根拠付きの契約テスト候補になる。

```text
## FR-001
Preconditions: 検証環境に注文は存在しない
Request: POST /orders に商品A、数量1を送信する
Response: 201 と発行された注文IDが返る
Test Data: 商品A、数量1
```

同一ファイル内の同じ条件・操作・データ・期待結果は1つのTSTにまとめ、対応する全REQ/FNCと根拠行を結びつける。
異なる条件は別TSTとする。事前条件やデータが未記載なら空のままで公開不可にし、推測して補わない。
節の要件対応を無関係な同階層の節へ引き継がない。コードフェンス内の例は確定試験へ昇格せず、未分類根拠として残す。
これは任意のOpenAPI/YAMLを解釈するパーサーではない。未対応の記述は原文を保持し、意味レビューで補完する。

## 6. リンクとcoverage

リンクはIDやrationaleを持たない`type/from_id/to_id`の3項目で表す。

```json
{
  "type": "requirement-to-function",
  "from_id": "FR-004",
  "to_id": "FNC-002"
}
```

許可するtypeと向きは次の3種類だけである。

- `requirement-to-function`: requirement → function
- `function-to-test`: function → test case
- `requirement-to-test`: requirement → test case

重複link、自己link、型と向きが不正なlinkを拒否する。currentの規範要件は1件以上の機能、全機能は
上流要件と1件以上のテスト、全テストは1件以上の機能を必要とする。現行の検証対象要件は直接
`requirement-to-test`を必要とする。テストが参照する各要件は、少なくとも1つの対象機能の上流要件である。
1件の要件が複数機能へ関係する場合、同じ試験を機能ごとに複製せず、同じTSTを検証対象FNCへリンクする。
各TSTの要件集合は対象FNC群の上流要件の和集合に含まれ、各対象FNCと最低1件の検証要件を共有する。
例えば「注文要件→注文機能」「決済要件→決済機能」の両方を検証する結合TSTを許可し、無関係な
機能をそのTSTへ追加することは拒否する。全TSTに直接REQ→TSTリンクが必要である。
現行要件のcoverageにはcurrent機能だけを数え、その機能と要件の両方に結びつくテストが必要である。
current機能はcurrentの規範要件を最低1件必要とし、future/retired機能や対象外要件を現行の対応済み件数へ混入させない。

## 7. 派生文書

### 7.1 Markdown

- 要件定義書: 目的・概要、要件一覧、主要エンティティ、未決事項、未分類の補足成果物。
- 機能一覧: 機能表と、対応REQ/TST、起動契機、根拠区分、導出理由、source refを含む機能詳細。
- テスト一覧: 対象FNC/REQ、type、level、priority、期待結果、automation_statusの表と、preconditions、
  steps、expected_result、source refを含むテスト詳細。

各Markdownはcanonical JSONから生成され、直接編集しない。テスト一覧は実施結果ではなく試験項目一覧である。
内部JSONのenum値は安定した英語表記を維持する一方、MarkdownとHTMLでは読者向けの日本語へ変換する。
少なくとも`acceptance-scenario`を「受入条件」、`current`を「今回の対象」、`unspecified`を
「未設定（要確認）」と表示し、各文書の冒頭に用語の見方を説明する。
各Markdownは目的、完成度、残件数、次の行動を冒頭に示す。機能境界未確認は「候補」、テストの
preconditions/steps/expected_result不足は「要具体化」とする。内部return_toは行動文へ変換し、生JSONや
空配列を本文へ再掲しない。元資料位置は`spec.md 16行目`のように表示する。

### 7.2 統合HTML

HTMLは「概要・要件・機能・テスト・トレーサビリティ・未決／変更影響」の6タブを順番固定で持つ。
単一UTF-8 HTMLへCSS/JavaScriptを内蔵し、外部networkに依存しない。

タブは`tablist/tab/tabpanel`、`aria-controls`、選択状態、矢印/Home/End/Enter/Space操作を持つ。
表にはcaption、thead、`scope=col`を付け、ID間はページ内リンクで移動できる。印刷時は全panelを表示する。
HTML上部には総合状態、要件/機能/テスト/未決件数、次の確認への導線を置く。品質は
`問題なし|確認推奨|要対応`の3表示とし、warningを問題なしに見せない。補足の全項目は`details/summary`へ
折り畳み、空値を省略する。テスト一覧は操作と実施可否、追跡表は人が読める要件名と接続状態を表示する。

## 8. 品質ゲート

`report`は次の形である。

```json
{
  "status": "publishable",
  "profile": "publish",
  "axes": {
    "source_integrity": {
      "status": "passed",
      "errors": [],
      "warnings": [],
      "metrics": {"errors": 0, "warnings": 0}
    }
  },
  "blocking_errors": 0
}
```

軸は`source_integrity`、`requirements_quality`、`function_coverage`、`test_coverage`、
`cross_artifact_consistency`、`render_reproducibility`の6つである。axis statusは`passed|failed`、
report statusは`publishable|draft-ready|blocked`。draftの検査成功を公開可能とは表示しない。診断は`errors`と`warnings`へ分ける。

draftでもスキーマ、ID、リンク、coverage、必須fieldなどの構造エラーはerrorになる。profile差は主に次である。

- `blocked`要件: draftはwarning、publishはerror。
- 未決事項: publishではerror。
- 解決済み質問の`resolution`（判断理由）・根拠不足、意味レビュー質問の欠落: publishではerror。
- 現在の資料と一致するレビュー対象版の記録がない・失効している: draftはwarning、publishはerror。
- 現行の未確認（`basis: derived`）機能、具体化されていないテスト条件・データ: draftはwarning、publishはerror。
- 測定不能と判定されたSuccess Criteria: warningに加え、publishではerror。
- 未チェックchecklist項目: draftはwarning、publishはerror。
- 単一要件文をそのまま写した`basis: derived`機能: draftはwarning、publishはerror。レビューで独立機能と
  確認できた場合は`basis: confirmed`にする。

source欠落・sha256不一致、ID/registry重複、不正link、孤立FNC/TST、必須steps/expected_result欠落、
derived要素のrationale欠落はprofileに関係なくerrorである。plan-enrichedではplan、research、data-model、
quickstartのsourceが全て必要である。

render_documentsはschemaとsource/link構造をdraft評価してから4投影を生成する。check_documentsはsourceを
再照合し、canonical JSONからメモリ上で再生成した4投影と`--output-dir`の各ファイルをバイト比較する。
欠落または不一致は`render_reproducibility` errorになる。
`report`は計算結果のキャッシュであり、編集後の古い判定を信用しない。render/checkは正本内容から
判定を再計算する。renderは正本を書き換えない。`--feature-dir`なしのrenderでは入力・checklistが
未照合であると警告するので、提出用の生成では入力ディレクトリを指定する。

自動生成は初期draftであり、明示IDやGiven/When/Thenで対応が確定しない補足資料は原文ごと保留する。
意味レビュー担当エージェントは入力を読み、機能境界・契約・状態・測定方法を補完し、質問を解決した
根拠と理由を残す。意味レビュー未完了の質問はpublishをブロックする。JSON Schemaと機械検査は
任意の自然言語の意味や期待結果の真実性までは証明しない。

## 9. CLIと終了コード

```bash
python <skill>/scripts/generate_documents.py <feature-or-spec> \
  --output-dir <dir> --mode auto --profile draft \
  [--extra-artifacts manifest.json] [--name <stem>]

python <skill>/scripts/render_documents.py <canonical.json> \
  --output-dir <dir> [--name <stem>] [--feature-dir <feature-dir>]

python <skill>/scripts/check_documents.py <feature-or-spec> <canonical.json> \
  --output-dir <dir> --profile publish [--name <stem>]
```

generateは同名canonical JSONが出力先にあれば編集を保護する更新規則を適用し、JSONと4投影を一時ディレクトリで
組み立てて置換する。publishにblocking errorがある場合は成果物を書かず終了コード1を返す。
入力更新とレビュー修正が重なった場合も終了コード1で既存成果物を保持する。
`--update-proposal`は既存正本とdraftプロファイルを必須とし、`<name>_update-proposal_*`の5成果物へ出力する。
同名更新案が既にある場合は終了コード2で停止する。比較レビュー後、根拠付きで`update-review`を解決し、
render/checkで検査してから新正本として採用する。変更した明示ID要件は`change_impact`の`modified`に記録する。
`compare_documents.py <旧JSON> <更新案JSON> --output <比較.md>`はschema検査後、全編集フィールド・
関連・根拠資料・解決済み質問の差分を出力する。旧資料のstaleな根拠は比較の妨げにせず、正本は変更しない。
既存出力・入力と同じパスには書き込まない。比較結果は自動承認や自動マージではない。

renderは4投影のpathを、generateはcanonicalを含む5成果物のpathを標準出力する。renderに
`--feature-dir`を渡すとsource fingerprintとlocatorも検査する。checkはreport JSONを
標準出力する。終了コードは成功0、品質上のblocking error 1、入力・JSON・I/O等の処理エラー2である。
