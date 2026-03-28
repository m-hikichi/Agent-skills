# Installation

`spec-driven-dev` は、分割後の spec skill 群における親ルーター兼、hooks / reviewer / verification scripts の共通基盤である。

## インストール方針

core family の sibling skill は次を同じ階層にそろえて配置する。

- `spec-driven-dev`
- `spec-impact-analysis`
- `spec-authoring`
- `spec-implementation`
- `spec-audit`

`reverse-spec` は family 外の bootstrap skill として、必要な場合だけ追加で同じ階層に置く。

親子はシステム上の正式な階層機能ではないが、分割後の docs と参照パスはこの sibling 構成を前提にしている。手動で配置する場合も、ディレクトリ名はこのまま保つ。

## 使い分け

- 入口が曖昧なら `spec-driven-dev`
- 目的が明確なら core child skill を直接使う
- 実装系の往復は親 `spec-driven-dev` が `spec-authoring` / `spec-implementation` / `spec-audit` を組み合わせて管理する
- 仕様資産が無い既存コードだけは、family 外の `reverse-spec` を先に使う
- 最後の停止可否は child skill ではなく共通 reviewer が判定する

## hooks / reviewer はどこにあるか

完了ブロックの共通基盤は、分割後も `spec-driven-dev` 配下にだけ置く。

- `scripts/review_stop_gate.py`
- `scripts/run_verify_stop_hook.ps1`
- `scripts/run_verify_stop_hook.sh`
- `scripts/verify_spec_consistency.py`
- `scripts/run_verify_in_docker.ps1`
- `scripts/run_verify_in_docker.sh`

`.claude/settings.json` の `Stop / SubagentStop` reviewer も、引き続き `spec-driven-dev/scripts/run_verify_stop_hook.*` を指す。

詳細な設定例は [references/claude-code-hooks.md](references/claude-code-hooks.md) を参照する。

## skill ごとの references はどこにあるか

skill 固有のテンプレートや playbook は各 skill の `references/` に置く。

- `spec-authoring/references/`: requirements / spec / matrix テンプレート
- `spec-audit/references/`: 監査チェックリスト
- `reverse-spec/references/`: family 外 bootstrap 用の逆生成 playbook

親 `spec-driven-dev` には、child 固有の作業資料を重複して残さない。

## 完了保証の考え方

分割後も前提は変えない。

1. `verify_spec_consistency.py`
2. `verification.project_test_commands`
3. `## 最終整合性監査` の `判定: clean`

この 3 条件を reviewer が再確認して、Claude Code の完了ブロックを成立させる。`needs-user-decision` は完了ではなく、人間判断待ちの一時停止として扱う。

core child skill はこの完了保証を単独では持たない。`spec-authoring` は docs をそろえ、`spec-implementation` は実装と機械検証を返し、`spec-audit` は findings を返す。往復ロジックと最終 close out は親または外側の実行主体が持つ。

フォルダは `skills/<skill-name>/SKILL.md` という skill loader 前提に合わせて sibling のまま保つ。family か bootstrap かの区別は、ディレクトリ階層ではなく役割定義で行う。
