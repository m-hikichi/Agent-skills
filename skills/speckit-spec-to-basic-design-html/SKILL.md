---
name: speckit-spec-to-basic-design-html
description: >-
  GitHub Spec Kit の feature ディレクトリ、spec.md、または同等の要求仕様から、開発者・
  プログラマー・マネージャーがレビューできる基本設計を、git管理可能な v3 design.json と
  自己完結HTMLとして生成・更新する。specだけなら要求・機能・論理データを扱う機能設計、
  plan/research/data-model/contracts/quickstartもあれば構成・重要フロー・状態・型付き契約・
  非機能検証まで扱う実装準備設計にする。要求根拠、未決事項、4軸の資料準備度を検査し、
  技術詳細を推測しない。「機能一覧を作って」「specを基本設計へ」「処理フローや状態遷移も必要か」
  「実装へ渡せる資料にして」「Excelの設計書をgitレビュー可能に」「既存設計を更新」などで使う。
  Excel(.xlsx)自体、詳細なタスク見積り、またはプロジェクト管理だけが目的の依頼には使わない。
---

# Spec Kitから段階的な基本設計を作る

## 成果物と正本を分ける

次の優先順位を守る。

1. feature ディレクトリの各 Spec Kit 成果物 — 担当領域ごとの正本
2. `<対象>_基本設計.design.json` — 正本群から構成した派生設計の正本
3. `<対象>_基本設計.html` — JSONから決定的に生成するレビュー表示

要求のWhat/Whyは`spec.md`、技術構成と実装方針は`plan.md`、判断理由は`research.md`、論理・
物理データは`data-model.md`、wire契約は`contracts/`、動作確認は`quickstart.md`を正とする。
`tasks.md`は進捗・依存関係の正本であり、HTMLにはフェーズ、依存、完了数だけを読み取り専用で要約する。
HTMLを直接編集しない。設計変更は正本側とJSONへ反映し、再生成する。

詳細なv3スキーマ、根拠オブジェクト、図、契約、品質ゲート、移行規則を使う前に
[`references/format_spec.md`](references/format_spec.md)を全文読む。

## 1. 入力を発見して資料レベルを決める

feature ディレクトリを指定されたら、次を探索する。

- 必須: `spec.md`
- 実装準備に必要: `plan.md`、`research.md`、`data-model.md`、`quickstart.md`
- 外部インターフェースがある場合に必要: `contracts/`配下のOpenAPI、AsyncAPI、JSON Schema等
- 任意: `tasks.md`、constitution、既存コード構成

JSONの`document_level`を先に決める。

- `spec.md`だけ、実装準備用成果物が不足、または資料レベル未指定: **機能設計** (`functional-design`)
- ユーザーが実装準備を求め、必須成果物と必要な契約が揃う: **実装準備設計** (`implementation-ready`)

部分的なplan一式があっても、欠落を推測で埋めない。機能設計として生成し、実装準備に足りない成果物を
レビュー概要へ表示する。CLIの`--level auto`はdesign.jsonの`document_level`を使用し、未指定なら
`functional-design`とする。`--level implementation-ready`を指定した場合は不足をブロックする。

各入力を`source.artifacts`へ`type`、featureディレクトリからの相対`path`、見出し・JSON Pointer等の
`locator`、SHA-256 `fingerprint`とともに記録する。ファイル全体なら`locator: "*"`を使う。
fingerprintは初回だけ空欄または64桁の0として検査器に計算させ、手入力しない。既存fingerprintの
不一致は設計未追随としてブロックし、自動更新しない。正本と設計を意図的に同時更新した場合だけ、
該当fingerprintを空欄へ戻して再記録する。

## 2. 成果物を読み、矛盾を先に解消する

全文を読み、次の役割で情報を抽出する。

- `spec`: User Story、受入シナリオ、FR、Edge Case、Clarification、Assumption、Success Criteria、対象外
- `plan`: システム境界、コンテナ、技術制約、配置・運用方針
- `research`: 技術判断、比較案、採否理由
- `data-model`: エンティティ、属性、関係、状態と制約
- `contract`: API、イベント、バッチ、ファイル、手動運用の厳密な境界
- `quickstart`: E2E確認方法と実行条件
- `tasks`: フェーズ、依存、チェック済み件数。見積りや担当を設計判断として取り込まない

同じ事項が矛盾する場合は都合のよい方を選ばない。要求同士は`/speckit.clarify`、設計成果物間は
`/speckit.analyze`、技術設計の不足は`/speckit.plan`へ戻す確認事項として記録する。

## 3. 要求と根拠を追跡する

`traceability`へすべての規範要素を1件ずつ置く。対象はFRだけでなく、User Story、Acceptance、
Edge Case、Clarification、Assumption、Success Criteria、Out of Scopeを含む。

- `covered`: 現行機能、設計要素、または検証で充足
- `future`: 将来機能として明示
- `out-of-scope`: 対象外として明示
- `partial` / `unresolved`: ドラフトのみ。確定時はブロック

明示IDがない要素はfingerprintと`source_catalog`で安定IDを維持する。機能、フロー、状態遷移、
データ、契約、品質シナリオ、検証から元の成果物まで、両方向に追える参照を持たせる。

## 4. 機能設計を作る

機能は業務上独立して説明・受入確認できる責務で切る。入力、読込、保存、表示のような実装工程を
機械的に分割しない。実行境界、独立した業務判断・状態遷移、単独の失敗処理が分割の根拠になる。

各機能には安定した`FNC-xxx`と次を記録する。

- 名称、概要、分類、提供状態
- User Story等に明記された要求優先度と根拠。未指定なら捏造せず「未指定」
- アクターを起動者、処理主体、受信者、運用担当に分離
- 起動契機、実行形態とインターフェース参照
- 入出力、事前条件、事後条件、業務ルール、例外、対象データ
- `specified` / `derived` / `confirmed`と根拠

spec単独では、要求に明記された業務フロー・状態だけを構造化する。技術スタック、コンテナ、物理DB、
method/path、型、認証、トランザクション、排他、再試行間隔、運用復旧を一般論から作らず「未確定」とする。

## 5. 実装準備設計を追加する

plan一式が揃う場合だけ、正本の記載に基づき次を加える。

- `architecture`: C4 System ContextとContainer相当。Component/Code図は明示要求がある場合だけ
- `workflows`: 複数機能・実行境界を横断する重要シナリオのactivityまたはsequence
- `state_models`: 状態で操作可否が変わる業務エンティティの全許可・禁止遷移
- `entities`: 属性、型、必須性、関係、制約と根拠
- `interfaces[].contract`: API、イベント、バッチ、外部連携、手動運用の型付き契約
- `quality_scenarios`: 性能、可用性、セキュリティ、運用性等を刺激・応答・測定値で表現
- `risks`: 影響、確率、軽減策、状態、根拠
- `verification`: Success Criteriaと重要NFRの具体的な検証方法・期待結果
- `delivery_summary`: tasksがある場合だけ、フェーズ・依存・完了数を要約

図は全機能へ付けない。分岐、外部連携、非同期、再試行、重要異常系、または状態依存があり、表だけでは
誤解しやすい代表シナリオに限定する。不要な場合も`applicability.workflows/state_models`へ根拠を記録する。
構造化JSONを正本とし、同じ内容のインラインSVGとHTML表を生成する。
workflowの表にはstepだけでなく参加者ID、名称、役割、根拠も含め、SVGのlifeline情報を欠落させない。

## 6. 未確定事項を処理する

要求にない数値、期限、既定値、エラー挙動、状態、権限、実行時刻、技術選択を推測しない。
影響が大きい不足は`open_questions`へ根拠、影響要素、戻り先コマンドとともに記録する。

- 要求・業務判断: `/speckit.clarify`
- 技術構成・契約・運用設計: `/speckit.plan`
- 成果物間の不整合: `/speckit.analyze`

ユーザー回答はまずspecのClarificationsまたは該当する正本へ記録し、検査器が`requirement_decisions`へ
質問・回答・source locatorを取り込む。そのIDを影響する設計へ反映する。
回答済みでも設計未反映なら`answered`のままブロックし、すべての`affected_refs`が同じCL IDを
参照した後だけ`resolved`にする。plan/research由来の技術ADRをユーザー確認IDとして代用しない。

## 7. 4軸の資料準備度を検査する

単一の`quality: passed`で全体を合格させない。`report.readiness`を次の4軸で個別判定する。

- `requirements_coverage`: 規範要素と根拠の網羅、Success Criteriaの検証対応
- `functional_design`: 機能責務、重要フロー、必要な状態遷移、論理データの充足
- `implementation_contracts`: 構成、型付き契約、トランザクション・排他・再試行条件の充足
- `operational_readiness`: 監視、障害時復旧、移行、運用確認の充足

各軸は`passed` / `failed` / `not-evaluated` / `not-applicable`で判定する。機能設計では後二軸を
`not-evaluated`として明示し、文書全体を「実装準備完了」と表示しない。
状態を持つ要求には完全な状態遷移表または不要理由、重要な横断シナリオにはフローまたは不要理由、
全Success Criteriaには検証方法が必要である。再送上限だけでなく、上限到達後の復旧も実装準備に必要となる。
`TBD`、`undetermined`、`未確定`、`要確認`等のplaceholderは、型、契約、状態遷移、検証方法、測定値を
満たしたことにならない。open questionと戻り先を残して該当軸をブロックする。

## 8. 生成して再現性を確認する

```bash
python <skill>/scripts/check_design_html.py <feature-dir> design.json --level auto --write-report
python <skill>/scripts/build_design_html.py design.json --feature-dir <feature-dir> --level auto
python <skill>/scripts/check_design_html.py <feature-dir> design.json design.html --level auto
```

旧CLIの`spec.md design.json [html]`も互換用に利用できる。生成後検査では入力fingerprint、参照整合、
HTMLの自己完結性・アクセシビリティに加え、JSONから一時再生成したHTMLとのバイト一致を確認する。
古いHTMLを成功扱いしない。
v3確定版ではfeatureディレクトリ検証を省略しない。buildで`--feature-dir`を省略した場合は正本specの
親を基準に導出し、明示`--spec`と`source.artifacts`のspec path/内容が違えばブロックする。

## HTMLの10ビュー

データがあるビューだけタブ表示する。

1. レビュー概要 — 資料レベル、4軸準備度、未決、主要リスク、入力鮮度
2. システム構成 — Context、Container、設計判断
3. 機能一覧 — 分類、ID、責務、役割別アクター、実行形態、状態
4. 機能詳細 — 入出力、条件、ルール、例外、データ、根拠
5. フロー・状態 — 重要フローと状態遷移のSVGおよび同内容の表
6. データモデル — エンティティ、属性、関係、制約
7. インターフェース・契約 — API、イベント、バッチ、外部連携、手動運用
8. 品質・検証・リスク — NFRシナリオ、検証、リスク、未確定事項
9. トレーサビリティ — 要求から設計・検証までの双方向対応
10. 実装計画要約 — tasksがある場合のみ。フェーズ、依存、完了数

単一HTMLにCSS/JavaScript/SVGを内蔵し、外部URLとインライン`style`属性を使わない。図とタブは
キーボード操作、ARIA、表形式の代替表現を備える。

## 更新とv2移行

- 先に正本群の差分を確認し、既存`FNC-xxx`、分類、文言、インターフェースIDを維持する。
- JSONを更新してからHTMLを再生成し、意味差分は主にJSONでレビューする。
- 削除要求の機能を黙って消さず、廃止・将来・対象外の扱いを確認する。
- v1/v2からは次でv3ドラフトへ移行する。

```bash
python <skill>/scripts/migrate_design.py spec.md v2-design.json -o v3-design.json
```

移行では既存ID、分類、順序、文言を保持し、新しい技術情報を捏造しない。不足は準備度と確認事項にする。
