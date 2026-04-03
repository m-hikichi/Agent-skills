# トレーサビリティマトリクス

1 行を `要件ID -> 仕様ID -> FR/NFR -> 実装シンボル -> テストID` の 1 組にする。1 つの要件が複数ファイルや複数仕様に跨るときだけでなく、同じ `FR-` / `NFR-` が複数実装シンボルや複数要件にまたがるときも行を分ける。

## ステータス凡例

- `✅`: 実装・テスト・仕様の整合性確認済み
- `🔧`: 実装中。仕様はあるが変更が完了していない
- `⚠️`: 仕様変更またはコード変更が片側にだけ入っている
- `❌`: 未実装
- `🗑️`: 廃止済み。履歴として残す

## テンプレート

```markdown
# トレーサビリティマトリクス

| 要件ID | 仕様ID | 機能ID(FR/NFR) | 実装ファイル | シンボル種別 | シンボル名 | テストファイル | テストID | ステータス |
|---|---|---|---|---|---|---|---|---|
| FC-01-01-001 | SPEC-001 | FR-001 | src/todos/create.ts | function | createTodo | tests/todos/create.test.ts | TC-001 | ✅ |
| FC-01-01-001 | SPEC-001 | FR-001 | src/todos/CreateTodoForm.tsx | component | CreateTodoForm | tests/todos/CreateTodoForm.test.tsx | TC-002 | ✅ |
| FC-01-01-001 | SPEC-001 | FR-002 | src/todos/CreateTodoForm.tsx | component | CreateTodoForm | tests/todos/CreateTodoForm.test.tsx | TC-003 | 🔧 |
| NF-001 | SPEC-001 | NFR-001 | src/todos/create.ts | function | createTodo | tests/perf/todos.test.ts | TC-101 | ❌ |
```

## 更新ルール

- `requirements.md` の対応表と矛盾しないように保つ。
- 仕様書を作成したターンで初期行を追加する。
- `実装トレーサビリティ契約` と同じ粒度、同じ名前で保つ。
- 同じ `FR-` / `NFR-` が複数シンボルにまたがるなら、機能IDを重複させて行を分ける。
- 同じ `FR-` / `NFR-` が複数要件に対応するなら、要件IDごとにも行を分ける。
- ファイル移動、関数リネーム、クラス名変更、テスト追加・削除があれば同じターンで更新する。
- 実装ファイルが複数ある場合でも、あとで検索できる粒度まで分解する。
- 実装が廃止されたら行を消さず、ステータスを `🗑️` にし、必要なら仕様側の判断記録で理由を残す。
- 監査時は、表のパス、シンボル種別、シンボル名、テストIDが現実と一致するか必ず確認する。
- `TC-XXX` が実際のテストコードから検索できない状態を許容しない。
