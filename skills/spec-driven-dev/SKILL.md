---
name: spec-driven-dev
description: Markdown仕様書を単一の真実源として扱い、要件定義、仕様書作成・更新、仕様からの実装とテスト導出、仕様とコードの整合性監査、変更影響分析、既存コードからの仕様逆生成、トレーサビリティ管理を進めるスキル。ユーザーが「仕様」「スペック」「要件」「SPEC-」「FR-」「トレーサビリティ」に触れたときは必ず使う。機能追加、バグ修正、リファクタリング、既存コード調査の依頼でも、ユーザー向け挙動や契約が変わる可能性があるならこのスキルで仕様影響を先に確認する。
---

# Spec-Driven Development

設計資料は 2 層で管理する。`docs/requirements.md` で WHAT を定義し、`docs/specs/SPEC-XXX-*.md` で HOW と機能単位の仕様を定義する。ユーザー向けの振る舞い、契約、制約を変えるなら、要件・仕様・テスト・実装・トレーサビリティを同じ流れで更新する。

## 守る原則

- 仕様書を Single Source of Truth として扱う。
- プロジェクト全体の要件は `requirements.md`、機能単位の詳細は `SPEC-XXX` に分ける。
- `requirements.md` では `FC-LL-MM-NNN` と `NF-NNN` を固定IDとして扱う。
- 要件ID、仕様ID、テストIDは安定識別子として扱い、既存IDをむやみに振り直さない。
- ユーザー向け挙動が変わる変更では、コード変更と同じターンで仕様更新を提案または実施する。
- 内部リファクタリングだけで挙動が変わらないなら、仕様更新不要と判断して理由を明示する。
- 既存コードに仕様や対応表が無ければ、大きな編集の前に最低限の逆生成を行う。
- 1つの仕様書には「まとまりのある機能」を入れ、ファイル単位やチケット単位に分割しすぎない。

## 最初に確認すること

1. `spec-config.json` を探す。無ければ [references/spec-config-template.json](references/spec-config-template.json) を元に作成または提案する。
2. `requirements_path`、`spec_dir`、`traceability_path` を確認する。標準は `docs/requirements.md`、`docs/specs/`、`docs/traceability-matrix.md`。
3. 既存の仕様書、要件書、テスト、設計メモを確認し、どれが現行の正と見なされているか整理する。
4. 今回の依頼がどのワークフローに当たるか決め、必要な参照資料だけ読む。

## 依頼からワークフローを選ぶ

| 依頼の種類 | 実行すること | 追加で読む資料 |
|---|---|---|
| 新規機能の相談、要件整理、機能一覧の洗い出し | 先に `requirements.md` を整理し、その後で仕様単位へ分割する | [references/requirements-template.md](references/requirements-template.md) |
| 「仕様書を書いて」「スペックを作って」 | 仕様書を新規作成または更新する | [references/spec-template.md](references/spec-template.md) |
| 「仕様から実装して」「この SPEC を進めて」 | 承認済み仕様からコードとテストを実装する | [references/traceability-matrix-template.md](references/traceability-matrix-template.md) |
| 「テスト一覧を作って」「テスト仕様を書いて」 | FR/NFR からテストケースを導出する | [references/spec-template.md](references/spec-template.md) |
| 「仕様とコードが合ってるか確認して」 | 整合性監査を行う | [references/consistency-checklist.md](references/consistency-checklist.md) |
| バグ修正、機能改善、リファクタリング | 仕様影響を先に判定する | [references/change-impact-checklist.md](references/change-impact-checklist.md) |
| 既存コードに後から仕様を付けたい | 逆生成して仕様とマトリクスを作る | [references/reverse-spec-playbook.md](references/reverse-spec-playbook.md) |
| 「影響範囲を調べて」「トレーサビリティを見たい」 | マトリクスから仕様、コード、テストの接続をたどる | [references/traceability-matrix-template.md](references/traceability-matrix-template.md) |

## 要件を整理する

1. 既存仕様と重複しない機能境界を決める。
2. [references/requirements-template.md](references/requirements-template.md) を使って `docs/requirements.md` を作るか更新する。
3. プロダクトゴール、対象ユーザー、MVPスコープ、MVP対象外、受け入れ基準を明示する。
4. 機能要件は `FC-LL-MM-NNN`、非機能要件は `NF-NNN` で管理する。
5. 要件をグループ化し、`要件と仕様の対応（Traceability）` 表で `SPEC-XXX / FR-XXX` に接続する。
6. 仕様分割案を作り、何をどの `SPEC-XXX` に入れるか先に決める。

## 仕様を書く

1. [references/spec-template.md](references/spec-template.md) を使って仕様書を作る。
2. フロントマターには `spec_id`、`title`、`status`、日付、作者、`related_specs` を入れる。
3. `対応要件（requirements.md）` 表を作り、対象の `FC-` / `NF-` を `FR-` / `NFR-` へ接続する。
4. `機能仕様（要件実装一覧）` はグループ分けしたチェックリスト形式で書く。
5. `優先度`、`非機能要件`、`データモデル`、`API仕様`、`画面仕様`、`テスト仕様`、`依存関係`、`判断記録` をこの順で並べる。
6. 仕様を新規追加または更新したら、同じターンで `requirements.md` の対応表とトレーサビリティマトリクスも更新する。
7. 外部に見える判断が未確定なら、仮定を明示してユーザー確認を求める。

## 仕様から実装する

1. `approved` またはユーザー確認済みの仕様だけを実装対象にする。
2. 関連する仕様書と依存仕様を読み、対象外の要求を混ぜない。
3. 要件単位でコードを書く。可能なら実装箇所とテストから仕様IDをたどれるようにする。
4. 実装と同時にテストを書くか、少なくともテスト仕様を先に更新する。
5. 実装したファイル、主要シンボル、テストファイルを `要件ID -> 仕様ID -> FR/NFR` の粒度でマトリクスに追記する。
6. すべての対象要件が反映された後にだけ、仕様ステータスを `implemented` に更新する。

## テスト仕様を導出する

- 各 FR/NFR から正常系、異常系、境界値、権限・状態遷移の観点を洗い出す。
- テストケースは要件IDに紐づけ、仕様書内で参照できる状態にする。
- `requirements.md` の受け入れ基準を満たす結合テストや比較テストが必要なら追加する。
- コード実装前ならテスト仕様まで作る。コード実装後ならテストコードとマトリクスまで更新する。
- 複数要件を跨ぐ結合ケースは個別要件に加えて補助ケースとして記録する。

## 整合性を監査する

整合性監査では [references/consistency-checklist.md](references/consistency-checklist.md) を使い、少なくとも以下を確認する。

- 仕様書にある要件が実装とテストに到達できるか。
- `requirements.md` の `FC-` / `NF-` が `SPEC-XXX` と `FR-` / `NFR-` に接続されているか。
- マトリクスにあるファイルパス、シンボル名、テストが実在するか。
- 実装にだけ存在して仕様に無い振る舞いが無いか。
- 仕様ステータスと実装実態が一致しているか。

監査結果は、重大度ごとに差分、根拠、修正案を添えて返す。

## コード変更時に仕様影響を判定する

バグ修正や改善依頼では、先に [references/change-impact-checklist.md](references/change-impact-checklist.md) を使う。

- API、UI、入力検証、エラー条件、権限、データ構造、性能保証が変わるなら、仕様影響ありと扱う。
- プロダクトゴール、MVPスコープ、受け入れ基準、`FC-` / `NF-` の約束が変わるなら `requirements.md` も更新する。
- 影響ありなら要件、仕様、テスト仕様、マトリクスを更新する。
- 影響なしなら、その理由を短く記録してから実装する。
- 変更対象がどの仕様にも紐づかないなら、先に逆生成して接続を作る。

## 既存コードから仕様を逆生成する

仕様が無い既存機能に触るときは、[references/reverse-spec-playbook.md](references/reverse-spec-playbook.md) に従って最小限の仕様化を行う。

- 既存のコード、テスト、README、API定義、画面遷移から観測可能な振る舞いを抽出する。
- 先に `requirements.md` の最小版を起こし、その後に `SPEC-XXX` へ分割する。
- 推測と事実を混ぜず、未確定な点は open questions として残す。
- 最初から完璧な仕様書を目指さず、今回の変更判断に必要な粒度まで作る。

## ステータス運用

`draft` → `review` → `approved` → `implemented` を基本とし、使わなくなった仕様は `deprecated` にする。

- `draft`: 作成中。前提や粒度がまだ揺れている。
- `review`: ユーザーまたは関係者の確認待ち。
- `approved`: 実装してよい内容が固まっている。
- `implemented`: コードとテストに反映済み。
- `deprecated`: 廃止済み。削除ではなく履歴を残す。

## 成果物の最低ライン

依頼の種類に応じて、次のどれかを必ず返す。

- 仕様作成: 更新した仕様書と追加した要件ID一覧
- 要件定義: 更新した `requirements.md`、追加した `FC-` / `NF-`、仕様分割案
- 実装: 変更コード、対応する仕様ID/要件ID、更新したマトリクス
- テスト設計: テストケース一覧と対応要件
- 整合性監査: 不整合一覧、根拠、修正候補
- 影響分析: 影響を受ける仕様、コード、テスト、未確定事項

## 参照資料

- [references/requirements-template.md](references/requirements-template.md): `docs/requirements.md` のテンプレート
- [references/spec-template.md](references/spec-template.md): 仕様書テンプレートとセクション選択ガイド
- [references/spec-config-template.json](references/spec-config-template.json): `spec-config.json` の雛形
- [references/traceability-matrix-template.md](references/traceability-matrix-template.md): マトリクスのテンプレートと更新ルール
- [references/consistency-checklist.md](references/consistency-checklist.md): 仕様とコードの監査チェックリスト
- [references/change-impact-checklist.md](references/change-impact-checklist.md): コード変更時の仕様影響判定
- [references/reverse-spec-playbook.md](references/reverse-spec-playbook.md): 既存コードから仕様を起こす手順
