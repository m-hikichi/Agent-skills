# 検証ゲート導入ガイド

Agent の文章だけで 100% 一致保証を作るのは難しい。強い保証が欲しいなら、分割後の spec skill 群の作業手順に加えて、共通の機械ゲートを置く。

## 3 層で考える

### 1. `verify_spec_consistency.py`

`requirements.md`、`SPEC-*.md`、`traceability-matrix.md`、実装ファイル、シンボル名、テストIDの対応を機械的に確認する。

強く検出できるもの:

- 仕様IDに対応する実装シンボルが存在しない
- 仕様書に書かれたファイル名、関数名、クラス名が現実と違う
- テストファイルが存在しない
- `TC-XXX` がテストコードから検索できない
- 仕様書、マトリクス、コードの対応関係が崩れている

### 2. `project_test_commands`

プロジェクト固有の自動テストで、仕様書の `実装完了条件` を確認する。

ここで見るもの:

- 正常系と異常系が仕様どおりか
- API、UI、状態遷移、権限、性能要件などの意味的な期待が満たされるか

### 3. `Stop` / `SubagentStop` reviewer

Claude Code の完了直前に `run_verify_stop_hook.*` を走らせ、次の 3 条件を見て OK / NG を返す。

1. `verify_spec_consistency.py` が成功
2. `project_test_commands` が成功
3. 最終メッセージの `## 最終整合性監査` が `判定: clean`

この reviewer があることで、「まだ NG なのに Claude が自分で終わった扱いにする」ことを止めやすくなる。

分割後も reviewer は 1 つの共通基盤として扱う。child skill は自分の役割ごとの summary / findings を返すだけで、最終停止可否の判定は設定側 reviewer が同じ 3 条件で見る。

## どこまで機械的に強制できるか

機械ゲートで強制できるのは、主に次の範囲。

- 仕様と実装の接続が崩れていないこと
- 指定したテストコマンドが実際に成功したこと
- Claude が最終監査を `clean` または `needs-user-decision` のどちらで閉じようとしているか

ここまではかなり強く自動化できる。

## どこから先は人間やプロジェクト固有レビューが必要か

次は hook だけでは保証できない。

- そのテスト群が十分か
- 仕様自体が正しいプロダクト判断か
- テストの外にある余計な振る舞いが本当に無いか
- `needs-user-decision` で止めた論点をどう決めるか

つまり、機械ゲートは「終わってよい最低条件」を担保する。仕様の妥当性や product decision そのものまでは代替しない。

## `SKILL.md` 単体との違い

- `SKILL.md` 単体
  - 親 skill はどの core child skill に振るかと、どこへ戻すかを定義する
  - 子 skill は自分の責務範囲の手順を定義する
  - ただし、Claude がその手順を守らずに止まる可能性は残る
- hooks 併用
  - reviewer が Stop / SubagentStop で毎回 3 条件を確認する
  - NG なら終了をブロックして Claude を作業へ戻す

完了ブロックまで含めて成立させたいなら、hooks は任意ではなく必須。

## 推奨フロー

1. 入口に応じて親 skill か core child skill を選ぶ
2. 仕様資産が無い既存コードだけは、family 外の bootstrap skill `reverse-spec` で requirements / specs / matrix の最小版を起こす
3. docs 更新が必要なら `spec-authoring` で requirements / specs / matrix をそろえる
4. 実装が必要なら `spec-implementation` で code / tests / matrix を更新し、機械検証を回す
5. `spec-audit` で整合性を監査し、Findings を `implementation-fix` / `spec-fix` / `needs-user-decision` で返す
6. Findings が残る間は、親 `spec-driven-dev` が `spec-implementation` または `spec-authoring` へ戻す
7. `High` / `Medium` がなくなったら、外側の最終報告で `## 最終整合性監査` を `clean` にする
8. Claude Code では `Stop` / `SubagentStop` reviewer に最終判定させる

## 一時停止をどう扱うか

人間の判断が必要で、その場で機械的に解けないときは `判定: needs-user-decision` を使う。

これは「完了」ではなく「人間確認待ち」の印。reviewer はこの状態なら停止を許すが、OK 完了とは扱わない。こうしておくと、修正で解ける NG と、人間の決定待ちを区別できる。
