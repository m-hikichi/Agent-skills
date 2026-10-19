# 実行トランスクリプト

## 対象と制約

- 適用スキル: `speckit-spec-to-basic-design-html`
- 入力: `api-order-feature` 配下の `spec.md`、`plan.md`、`research.md`、`data-model.md`、`contracts/openapi.yaml`、`quickstart.md`、`tasks.md` のみ
- スキル本体と必須参照 `references/format_spec.md` を全文確認した。
- tests、eval fixture、baseline snapshot、指定外のdesign JSONは参照していない。
- 入力およびスキルは編集していない。

## 実施内容

1. 7つのSpec Kit成果物を全文確認し、ユーザーが実装開始前レビューを求め、必須成果物と外部契約が存在するため `document_level: implementation-ready` とした。
2. specから38件の規範要素（User Story、Acceptance、Edge Case、Clarification、FR、SC、Assumption、Out of Scope）を抽出し、全件へtraceabilityを設定した。
3. 5機能、6インターフェース、System Context／Container構成、5件の技術判断、3重要フロー、1完全状態モデル、7エンティティを構造化した。
4. 6品質シナリオ、5リスク、7検証、tasksの現行22件中2件完了とフェーズ依存を記録した。DeferredのT900は現行進捗から除外した。
5. source artifactのSHA-256、38件のsource catalog、6件のspec Clarification decisionをcheckerで同期した。
6. checkerのschema・provenance診断に従い、生成IDの参照形式、workflow participant role、event schema、batch retryの構造を修正した。
   最終v3ゲートへの追随として、User Story由来のP1/P2優先度を全機能へ根拠付きで反映し、最新rendererで
   participant ID・名称・役割・根拠を含むSVG代替表を再生成した。
7. `build_design_html.py --allow-draft` で自己完結HTMLを生成した。CSS、JavaScript、SVGは内蔵され、入力JSONからの決定的再生成と提出HTMLのバイト一致をcheckerで確認した。
8. sandbox上ではPythonがworkspace配下へ直接書き込めなかったため、designをsystem tempへ複製して公式checkerの `--write-report` とbuilderを実行し、その生成結果を指定outputへ戻した。最終checkerは指定output上の実ファイルを直接検査した。
9. task専用system-temp中間ディレクトリの削除を試みたが、環境のusage-limitによる自動approval rejectionで実行されなかった。迂回削除は行っていない。正式成果物は指定outputの4ファイルだけである。

## 正本から確定できなかった実装ブロッカー

- `Q-001`: eventの「最大3回再送」と「3回目失敗でdead-letter」の総試行数が成果物間で不一致。
- `Q-002`: 外向きwebhookの配送先URL、設定単位、認証方式、credential更新・失効時の扱いが未定義。
- `Q-003`: 外部件数APIのbase endpoint、TLS、timeout、`attempts: 1`の意味が未定義／曖昧。
- `Q-004`: 日次job未完了の検知期限、再開・手動再実行、承認、証跡、通知解消条件が未定義。
- `Q-005`: 手動再送のpending更新と監査記録のtransaction／rollback境界が未定義。
- `Q-006`: `orders.transition` scopeで状態変更APIを呼ぶ業務主体・システムが未定義。
- `Q-007`: eventの順序保証単位と順序逆転時の扱いが未定義。
- `Q-008`: worker lease timeout値、停止時の回収、再claim時のattempt扱いが未定義。
- `Q-009`: webhook 400／401の隔離・alert・再送・手動復旧への接続が未定義。
- `Q-010`: data-modelが要求するalert対象時刻に対応するOutboxEvent属性が表に存在しない。
- `Q-011`: 外部件数APIの `reconciliation.read` がOAuth security schemeのscope一覧に存在しない。
- `Q-012`: external order number重複のdata-model制約に対応するAPI error契約がない。
- `Q-013`: SC-001の通常想定負荷についてrate、同時数、traffic mix、payload条件が未定義。

これらは値や方式を推測せず `open_questions` として記録し、`/speckit.clarify`、`/speckit.plan`、`/speckit.analyze` の適切な戻り先を指定した。

## 最終検査

実行対象:

```text
check_design_html.py <feature-dir> design.json design.html --level auto
```

結果:

```text
exit code: 1
ERROR: ユーザー確認が必要な未解決事項が13件あります
```

checker report:

- document status: `blocked`
- requirements coverage: `passed`
- functional design: `failed`（未解決blocking questions）
- implementation contracts: `passed`（構造検査）
- operational readiness: `passed`（構造検査）
- warnings: 0
- HTML構造・自己完結性・アクセシビリティ・鮮度・決定的再生成の追加エラー: 0
