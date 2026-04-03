---
name: spec-init
description: プロジェクトに spec-driven-dev の初期構成をセットアップする scaffold skill。`spec-config.json`、`requirements.md` 雛形、最初の `SPEC-XXX` 雛形、トレーサビリティマトリクス雛形をまとめて生成する。新規プロジェクトへの導入時に使う。
---

# Spec Init

この skill は、プロジェクトに spec-driven-dev の仕組みを導入するための初期セットアップを行う。**全てのファイルは Claude が自動生成する。** 人間に手動でファイルを作成させない。

## この skill が担当すること

- `spec-config.json` の生成（プロジェクト情報をユーザーに確認しながら）
- `docs/requirements.md` の雛形生成
- `docs/specs/` ディレクトリと最初の `SPEC-001` 雛形生成
- `docs/traceability-matrix.md` の雛形生成
- ディレクトリ構造の作成

## この skill が抱え込まないこと

- 要件の本格的な洗い出し（spec-authoring の責務）
- 既存コードの仕様化（reverse-spec の責務）
- 実装やテスト

## 手順

1. ユーザーに以下を確認する（対話的に）:
   - プロジェクト名
   - 使用言語・フレームワーク
   - ソースコードのルートディレクトリ（例: `src`, `app`）
   - テストのルートディレクトリ（例: `tests`, `src`)
   - テストフレームワーク（例: Vitest, Jest, pytest）
   - 命名規約（例: camelCase, snake_case）
   - 整合性検証の実行方法（docker / local）
   - プロジェクト固有テストコマンド（例: `npm test`, `docker compose run --rm app pytest`）
2. 確認した内容で `spec-config.json` を生成する。
3. `docs/` ディレクトリを作成する。
4. `docs/requirements.md` の雛形を生成する（プロダクトゴール、対象ユーザー、MVPスコープ等のセクション枠）。
5. `docs/specs/` ディレクトリを作成し、`SPEC-001` の雛形を生成する（frontmatter + 全セクション枠）。
6. `docs/traceability-matrix.md` の雛形を生成する（ヘッダー行のみ）。
7. 生成したファイルの一覧をユーザーに報告する。

## done 条件

- `spec-config.json` が生成されている
- `docs/requirements.md` が生成されている
- `docs/specs/SPEC-001-*.md` が生成されている
- `docs/traceability-matrix.md` が生成されている
- ユーザーに生成結果が報告されている

## init 専用 close out

```markdown
## Init Summary

- 生成した設定: `spec-config.json`
- 生成した要件: `docs/requirements.md`
- 生成した仕様: `docs/specs/SPEC-001-initial.md`
- 生成したマトリクス: `docs/traceability-matrix.md`
- 次のステップ: `requirements.md` にプロダクトゴールと要件を記入し、`/spec-driven-dev:spec-authoring` で仕様を固める
```
