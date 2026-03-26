---
name: spec-driven-dev
description: Markdown仕様書を単一の真実源として扱い、要件定義、仕様書作成・更新、仕様からの実装とテスト導出、変更影響分析、整合性監査、requirements / specs / matrix / code / tests のトレーサビリティ管理を進めるスキル。ユーザーが「仕様」「スペック」「要件」「SPEC-」「FR-」「トレーサビリティ」に触れたときに使う。Claude Code で完了ブロックまで行う運用では Stop / SubagentStop hook と併用する。
hooks:
  Stop:
    - hooks:
        - type: prompt
          prompt: |
            You are the report-format reviewer for spec-driven-dev.
            Inspect the Stop hook input JSON in $ARGUMENTS.
            Look only at last_assistant_message.
            Return {"ok": true} only when the message contains a section titled "最終整合性監査" and that section includes a line "判定: clean" or "判定: needs-user-decision".
            Return {"ok": false, "reason": "..."} otherwise.
---

# Spec-Driven Development

設計資料は 2 層で管理する。`docs/requirements.md` で WHAT を定義し、`docs/specs/SPEC-XXX-*.md` で HOW と機能単位の仕様を定義する。ユーザー向けの振る舞い、契約、制約を変えるなら、要件・仕様・テスト・実装・トレーサビリティを同じ流れで更新する。

このスキルは、自然言語の説明だけで終わらせない。各 `FR-` / `NFR-` に対して、どこに実装されるか、どのテストで検証するか、何をもって完了とみなすかを機械的に追える形で残す。

## 役割分担

### このスキル単体でできること

- 仕様影響を判定する
- `requirements.md`、`SPEC-XXX`、コード、テスト、マトリクスを同じターンでそろえる
- `実装トレーサビリティ契約`、`実装完了条件`、`最終整合性監査` の書式を固定する
- 完了時に確認すべき 3 条件を明示する

### Claude Code hooks と併用して初めて強制できること

- Claude が「たぶん終わり」と判断して止まる前に reviewer を走らせる
- `verify_spec_consistency.py`、`project_test_commands`、`最終整合性監査` を Stop / SubagentStop で再確認する
- reviewer が NG を返したら Claude Code の終了をブロックし、修正継続またはユーザー確認へ戻す

`SKILL.md` 本文だけでは完了ブロックを保証できない。Claude Code で「レビュー OK が出るまで終われない」運用にしたい場合、強制力は hook にある。設定は [references/claude-code-hooks.md](references/claude-code-hooks.md) と [INSTALL.md](INSTALL.md) を見ること。

## Claude Code で完了ブロックする前提

Claude Code で完了をブロックしたい運用では、次を前提にする。

1. `spec-config.json` に `verification.consistency_runner: "docker"` がある
2. `spec-config.json` に空でない `verification.project_test_commands` がある
3. `.claude/settings.json` または `~/.claude/settings.json` に `Stop` / `SubagentStop` hook を入れる
4. hook から `scripts/run_verify_stop_hook.ps1` または `scripts/run_verify_stop_hook.sh` を実行できる

この 4 つが無い場合もスキル自体は使えるが、Claude Code の完了ブロックは成立しない。

## 守る原則

- 仕様書を Single Source of Truth として扱う。
- プロジェクト全体の要件は `requirements.md`、機能単位の詳細は `SPEC-XXX` に分ける。
- `requirements.md` では `FC-LL-MM-NNN` と `NF-NNN` を固定IDとして扱う。
- 要件ID、仕様ID、テストIDは安定識別子として扱い、既存IDをむやみに振り直さない。
- ユーザー向け挙動が変わる変更では、コード変更と同じターンで仕様更新を提案または実施する。
- コードまたは仕様書を変更したターンでは、最後に必ず整合性監査を行い、差分が無くなるまで修正と再監査を繰り返す。
- 仕様書本文にファイル名や関数名を書くだけで済ませず、`実装トレーサビリティ契約` と `実装完了条件` にも落とし込む。
- ファイル移動、関数リネーム、クラス名変更、テスト移動は仕様影響ありとして扱い、同じターンで仕様とマトリクスを更新する。
- 内部リファクタリングだけで挙動が変わらないなら、仕様更新不要と判断して理由を明示する。
- 既存コードに仕様や対応表が無ければ、大きな編集の前に最低限の逆生成を行う。
- 1つの仕様書には「まとまりのある機能」を入れ、ファイル単位やチケット単位に分割しすぎない。

## 最初に確認すること

1. `spec-config.json` を探す。無ければ [references/spec-config-template.json](references/spec-config-template.json) を元に作成または提案する。
2. `requirements_path`、`spec_dir`、`traceability_path` を確認する。標準は `docs/requirements.md`、`docs/specs/`、`docs/traceability-matrix.md`。
3. `implementation_roots`、`test_roots`、`verification.consistency_runner`、`verification.project_test_commands` を確認する。
4. 既存の仕様書、要件書、テスト、設計メモを確認し、どれが現行の正と見なされているか整理する。
5. 今回の依頼がどのワークフローに当たるか決め、必要な参照資料だけ読む。

## 開始時に固定するタスク

作業を始めたら、頭の中でも Todo でもよいので、次の 4 つを必ず先に置く。

1. 仕様影響を判定する
2. 必要なコード、仕様書、テスト、マトリクスを更新する
3. 自動検証を通す
4. 最終整合性監査を clean か needs-user-decision にする

4 は差分が残っている限り完了にしない。これにより、監査を「最後に思い出したらやる作業」ではなく、完了条件そのものとして扱う。

## 完了条件

完了は次の 3 点がそろったときだけ主張してよい。

1. `verify_spec_consistency.py` が成功する
2. `verification.project_test_commands` が成功する
3. 最終メッセージの `## 最終整合性監査` が `判定: clean` になる

`判定: needs-user-decision` は「人間の判断待ちで一時停止している」状態であり、完了ではない。Claude Code の hook reviewer はこの違いを見て機械的に OK / NG を返す。

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
5. `実装トレーサビリティ契約` に、各 `FR-` / `NFR-` の `実装ファイル`、`シンボル種別`、`シンボル名`、`テストファイル`、`テストID` を 1 行ずつ書く。
6. `実装完了条件` に、各 `FR-` / `NFR-` が満たすべき観測可能な結果を、テストIDと一緒に書く。
7. 仕様を新規追加または更新したら、同じターンで `requirements.md` の対応表とトレーサビリティマトリクスも更新する。
8. 仕様変更後は必ず整合性監査を実行し、コード、テスト、マトリクス、ステータスとのズレを解消する。
9. 外部に見える判断が未確定なら、仮定を明示してユーザー確認を求める。

## 仕様から実装する

1. `approved` またはユーザー確認済みの仕様だけを実装対象にする。
2. 関連する仕様書と依存仕様を読み、対象外の要求を混ぜない。
3. `実装トレーサビリティ契約` と `実装完了条件` を先に埋める。コードはその契約に従って書く。
4. 要件単位でコードを書く。`実装ファイル`、`シンボル名`、`テストファイル` が仕様書とマトリクスからたどれる状態を保つ。
5. 実装と同時にテストを書くか、少なくともテスト仕様を先に更新する。テストIDはテスト名、コメント、describe 名などから検索できる形で残す。
6. 実装したファイル、主要シンボル、テストファイル、テストIDを `要件ID -> 仕様ID -> FR/NFR` の粒度でマトリクスに追記する。
7. 実装後は必ず自動検証と整合性監査を実行し、仕様、コード、テスト、マトリクスの差分が無いことを確認する。
8. すべての対象要件が反映され、最終監査が clean になった後にだけ、仕様ステータスを `implemented` に更新する。

## テスト仕様を導出する

- 各 FR/NFR から正常系、異常系、境界値、権限・状態遷移の観点を洗い出す。
- テストケースは要件IDに紐づけ、仕様書内で参照できる状態にする。
- `requirements.md` の受け入れ基準を満たす結合テストや比較テストが必要なら追加する。
- コード実装前ならテスト仕様まで作る。コード実装後ならテストコードとマトリクスまで更新する。
- テストケースごとに「どの挙動を確認するのか」を観測可能な文章で書く。
- 複数要件を跨ぐ結合ケースは個別要件に加えて補助ケースとして記録する。

## 自動検証を行う

1. `spec-config.json` にある `verification.consistency_runner` と `verification.project_test_commands` を確認する。
2. `consistency_runner` が `docker` なら、`scripts/run_verify_in_docker.ps1` または `scripts/run_verify_in_docker.sh` を使い、`requirements.md`、仕様書、マトリクス、実装ファイル、シンボル名、テストファイル、テストIDの整合性を先に機械検証する。
3. Docker が使えず、ユーザーが明示的に許可したときだけ `scripts/verify_spec_consistency.py` を直接実行する。
4. その後で `verification.project_test_commands` を順に実行し、仕様書の `実装完了条件` を満たすことを確認する。
5. 自動検証で失敗したら、失敗原因を `未実装`、`誤実装`、`仕様外実装`、`名前ずれ` のどれかに分類してから直す。
6. 自動検証が無いプロジェクトでは、追加を提案する。少なくともファイル存在、シンボル存在、テスト存在を確認する検証は整える。
7. Claude Code で完了ブロックする運用では、`Stop` / `SubagentStop` hook を必須にする。`run_verify_stop_hook.*` reviewer がこの 3 条件を機械的に再確認する。

## 変更後の整合性ループ

コードを変えたときも、仕様書を変えたときも、このループを必ず完了させてから作業を終える。

1. 変更対象に紐づく `requirements.md`、`SPEC-XXX`、コード、テスト、トレーサビリティマトリクスを対象として自動検証と整合性監査を行う。
2. 差分が見つかったら、どちらを直すべきかを判断する。原則として `approved` の仕様とユーザー確認済みの判断を優先し、コードだけがずれていればコードを直す。仕様が古ければ仕様、要件、テスト仕様、マトリクスを直す。
3. 修正後は同じ範囲でもう一度検証と監査を行う。
4. 不整合が 1 件でも残っている間は、報告だけで終わらず修正と再監査を繰り返す。
5. ユーザー判断が必要な外部仕様の揺れだけは `判定: needs-user-decision` として止めてよい。その場合は、どの差分が未解決かを明示して確認を求める。
6. 最終的に `High` / `Medium` の不整合が 0 件で、残る `Low` も許容理由を説明できる状態を完了条件とする。

## 整合性を監査する

整合性監査では [references/consistency-checklist.md](references/consistency-checklist.md) を使い、コード変更後と仕様変更後の両方で必ず実行する。少なくとも以下を確認する。

- 仕様書にある要件が実装とテストに到達できるか。
- `requirements.md` の `FC-` / `NF-` が `SPEC-XXX` と `FR-` / `NFR-` に接続されているか。
- `実装トレーサビリティ契約` とマトリクスのファイルパス、シンボル名、テストIDが実在するか。
- 実装にだけ存在して仕様に無い振る舞いが無いか。
- 仕様ステータスと実装実態が一致しているか。

監査結果は、重大度ごとに差分、根拠、修正案を添えて返す。差分があれば、その場で修正し、clean になるまで再監査する。

## 最終報告の固定書式

変更を伴う依頼を閉じる前に、最終メッセージの末尾へ必ず次を入れる。

```markdown
## 最終整合性監査

- 判定: clean
- 監査対象: `requirements.md`, `SPEC-012`, `src/foo.ts`, `tests/foo.test.ts`
- 実行した検証:
  - `run_verify_in_docker`
  - `project_test_commands`
- 修正した差分:
  - SPEC-012 の入力制約を実装に合わせて更新
  - `src/foo.ts` のエラー条件を仕様どおりに修正
- 残件: なし
```

人間の判断待ちで止めるときだけ、`判定: needs-user-decision` を使う。その場合は `残件:` に「誰が何を決める必要があるか」を短く書く。hook reviewer はこのブロックを機械的に読むため、見出し名と `判定:` の表記は崩さない。

## コード変更時に仕様影響を判定する

バグ修正や改善依頼では、先に [references/change-impact-checklist.md](references/change-impact-checklist.md) を使う。

- API、UI、入力検証、エラー条件、権限、データ構造、性能保証が変わるなら、仕様影響ありと扱う。
- ファイル移動、関数名変更、クラス名変更、テスト名変更、テスト移動も仕様影響ありと扱う。
- プロダクトゴール、MVPスコープ、受け入れ基準、`FC-` / `NF-` の約束が変わるなら `requirements.md` も更新する。
- 影響ありなら要件、仕様、テスト仕様、マトリクス、`実装トレーサビリティ契約` を更新し、その後に整合性監査を完了させる。
- 影響なしなら、その理由を短く記録してから実装し、最後に「仕様更新不要」の判断も含めて整合性監査で確かめる。
- 変更対象がどの仕様にも紐づかないなら、先に逆生成して接続を作る。

## 既存コードから仕様を逆生成する

仕様が無い既存機能に触るときは、[references/reverse-spec-playbook.md](references/reverse-spec-playbook.md) に従って最小限の仕様化を行う。

- 既存のコード、テスト、README、API定義、画面遷移から観測可能な振る舞いを抽出する。
- 先に `requirements.md` の最小版を起こし、その後に `SPEC-XXX` へ分割する。
- `実装トレーサビリティ契約` と `実装完了条件` は、観測できた事実だけで埋める。
- 推測と事実を混ぜず、未確定な点は open questions として残す。
- 最初から完璧な仕様書を目指さず、今回の変更判断に必要な粒度まで作る。

## ステータス運用

`draft` → `review` → `approved` → `implemented` を基本とし、使わなくなった仕様は `deprecated` にする。

- `draft`: 作成中。前提や粒度がまだ揺れている。
- `review`: ユーザーまたは関係者の確認待ち。
- `approved`: 実装してよい内容が固まっている。
- `implemented`: コードとテストに反映済みで、最終監査も clean。
- `deprecated`: 廃止済み。削除ではなく履歴を残す。

## 成果物の最低ライン

依頼の種類に応じて、次のどれかを必ず返す。

- 仕様作成: 更新した仕様書、追加した要件ID一覧、最終整合性監査の結果
- 要件定義: 更新した `requirements.md`、追加した `FC-` / `NF-`、仕様分割案
- 実装: 変更コード、対応する仕様ID/要件ID、更新したマトリクス、実行した検証コマンド、最終整合性監査の結果
- テスト設計: テストケース一覧と対応要件
- 整合性監査: 不整合一覧、根拠、修正候補、再監査後の最終状態
- 影響分析: 影響を受ける仕様、コード、テスト、未確定事項

## 参照資料

- [references/requirements-template.md](references/requirements-template.md): `docs/requirements.md` のテンプレート
- [references/spec-template.md](references/spec-template.md): 仕様書テンプレートとセクション選択ガイド
- [references/spec-config-template.json](references/spec-config-template.json): `spec-config.json` の雛形
- [references/traceability-matrix-template.md](references/traceability-matrix-template.md): マトリクスのテンプレートと更新ルール
- [references/consistency-checklist.md](references/consistency-checklist.md): 仕様とコードの監査チェックリスト
- [references/change-impact-checklist.md](references/change-impact-checklist.md): コード変更時の仕様影響判定
- [references/reverse-spec-playbook.md](references/reverse-spec-playbook.md): 既存コードから仕様を起こす手順
- [references/final-audit-template.md](references/final-audit-template.md): 最終整合性監査の報告テンプレート
- [references/verification-gate.md](references/verification-gate.md): 自動検証の導入と機械ゲートの役割分担
- [references/claude-code-hooks.md](references/claude-code-hooks.md): Claude Code hooks で完了ブロックを構成する最小設定
