# 基本設計機能一覧 v2 — JSON・品質・HTML仕様

## 1. 成果物

| ファイル | 役割 |
|---|---|
| `spec.md` | 要求の正本。確認回答もClarificationsへ記録する |
| `<対象>_基本設計_機能一覧.design.json` | 派生設計の正本。gitレビュー対象 |
| `<対象>_基本設計_機能一覧.html` | JSONから生成する自己完結ビュー。直接編集しない |

同じJSONとspecからはバイト同一のHTMLを生成する。HTMLは外部アセットとインライン`style`属性を
使わず、CSS/JavaScriptを内蔵する。

## 2. トップレベルスキーマ

```json
{
  "schema_version": 2,
  "source": {
    "spec": "specs/020-equipment-lending/spec.md"
  },
  "output": "specs/020-equipment-lending/備品貸出管理_基本設計_機能一覧.html",
  "title": "備品貸出管理　基本設計 機能一覧",
  "meta": {
    "作成日": "2026-06-01",
    "作成者": "",
    "更新日": "2026-07-05",
    "更新者": ""
  },
  "interfaces": [],
  "function_list": [],
  "traceability": [],
  "source_catalog": [],
  "decisions": [],
  "open_questions": [],
  "quality": {}
}
```

`quality`と`source_catalog`は`check_design_html.py --write-report`が更新する。手書きしない。
`source_catalog`は規範要素の本文fingerprintと既存IDを保持し、specへの途中挿入・移動で
`EC-xxx`等が振り直されるのを防ぐ。要求本文が変更された場合も高い類似度で既存IDを再利用し、
対応不能な新規項目だけ同種IDの末尾へ採番する。

## 3. インターフェース

画面と実行形態を同じ自由記述列へ混在させない。機能の起動・入出力境界をマスタ化する。

```json
{
  "id": "API-001",
  "type": "api",
  "name": "予約登録API",
  "summary": "指定された備品と期間の予約を受け付ける",
  "actors": ["利用者向けWebアプリ"],
  "status": "current"
}
```

許可する`type`:

- `screen`
- `api`
- `batch`
- `event`
- `external-interface`
- `manual`

`cross-cutting`は機能の`execution.type`だけで使用し、マスタ参照を持たない。

ID接頭辞の既定は`SCR-`、`API-`、`BAT-`、`EVT-`、`EXT-`、`MAN-`。既存規約があればそれを優先する。

## 4. 機能スキーマ

3階層はExcel風の俯瞰用に維持するが、ID列はHTML上で分類名とまとめて表示する。

```json
{
  "name": "備品利用",
  "id": "01",
  "children": [
    {
      "name": "予約管理",
      "id": "01",
      "children": [
        {
          "name": "予約受付",
          "id": "01",
          "rows": [
            {
              "id": "FNC-021",
              "name": "予約可否判定",
              "summary": "指定期間の在庫に基づいて予約の受付可否を決定する",
              "actors": ["利用者"],
              "trigger": "利用者が備品と利用期間を指定して予約を確定する",
              "execution": {
                "type": "screen",
                "refs": ["SCR-020"]
              },
              "inputs": ["備品ID", "利用開始日時", "利用終了日時"],
              "outputs": ["予約番号", "予約拒否理由"],
              "preconditions": ["利用者が認証済みである", "利用開始日時が利用終了日時より前である"],
              "postconditions": ["受付時は予約が確定する", "拒否時は予約データを作成しない"],
              "business_rules": [
                {
                  "id": "BR-021-01",
                  "text": "指定期間の利用可能在庫数を超える予約を拒否する",
                  "basis": "specified",
                  "source_refs": ["FR-021", "AC-001-02"]
                },
                {
                  "id": "BR-021-02",
                  "text": "取消済み予約は重複予約数へ含めない",
                  "basis": "derived",
                  "source_refs": ["FR-021", "FR-022"],
                  "rationale": "取消済みデータを在庫消費として扱うとFR-022の取消結果が反映されないため"
                }
              ],
              "exceptions": [
                {
                  "condition": "利用可能在庫数が不足する",
                  "behavior": "予約を拒否して代替期間を表示する",
                  "basis": "specified",
                  "source_refs": ["FR-021", "AC-001-02"]
                }
              ],
              "data_entities": ["備品", "予約", "貸出"],
              "source_refs": ["FR-020", "FR-021", "FR-022", "AC-001-01", "AC-001-02"],
              "status": "current"
            }
          ]
        }
      ]
    }
  ]
}
```

### 機能ID

- `FNC-xxx`形式で一意にする。
- 名称変更、分類移動、要件追加では既存IDを維持する。
- 削除IDを別機能へ再利用しない。
- 新規IDは既存の最大値より後ろへ追加する。

### 業務ルールの根拠区分

| basis | 必須条件 |
|---|---|
| `specified` | spec内の`source_refs`が1件以上ある |
| `derived` | `source_refs`と、要求から導出できる理由`rationale`がある |
| `confirmed` | `CL-xxx`または`decisions.id`への参照がある |

業務ルールの全`source_refs`は、その機能自身の`source_refs`にも含める。

### 例外

例外は`condition`、`behavior`、`basis`、`source_refs`を持つ。`basis`の制約は業務ルールと同じで、
導出した例外には`rationale`、確認済み例外には`CL-xxx`が必要となる。単に「エラーにする」と書かず、
処理結果、データ更新の有無、利用者への通知を判別できるようにする。

## 5. トレーサビリティ

```json
{
  "source_id": "FR-021",
  "function_ids": ["FNC-021"],
  "coverage": "covered",
  "rationale": "予約可否判定と拒否時動作で要求全体を充足する"
}
```

| coverage | 意味 | 確定版 |
|---|---|---|
| `covered` | 現行機能または検証方法で充足する | 可 |
| `future` | 将来機能として管理する | 可 |
| `out-of-scope` | 明示的に対象外である | 可 |
| `partial` | 一部だけ設計済み | 不可 |
| `unresolved` | 対応・解釈が未確定 | 不可 |

将来項目は`coverage: future`とし、紐付ける機能も`status: future`にする。対象外項目へ現行機能を
紐付けない。Success Criteriaを機能へ直接割り当てない場合は、`verification`へ検証方法を書く。

```json
{
  "source_id": "SC-001",
  "function_ids": [],
  "coverage": "covered",
  "verification": "予約完了までの操作時間を受入試験で計測する",
  "rationale": "複数機能を横断する成功指標のため"
}
```

機能→根拠と根拠→機能は一致させる。片方向だけの参照は品質エラーになる。

## 6. 確認事項と決定

未回答:

```json
{
  "id": "Q-021",
  "severity": "blocking",
  "function_id": "FNC-021",
  "question": "代替期間の提示件数を確認してください",
  "source_refs": ["FR-021", "AC-001-02"]
}
```

質問は同じ大分類・規範種別ごとに集約し、同内容を機能ごとに繰り返さない。

回答済み:

```json
{
  "id": "CL-20260705-01",
  "question": "代替期間を何件表示するか",
  "answer": "開始日時が近い順に3件表示する",
  "confirmed_on": "2026-07-05",
  "source_locator": "spec.md > Clarifications > Session 2026-07-05"
}
```

質問の状態は`open → answered → resolved`で進む。

- `open`: 未回答。確定版を生成できない。
- `answered`: specとdesignへ回答を記録済みだが、設計反映待ち。確定版を生成できない。
- `resolved`: 影響機能と業務ルールが`confirmation_id`の`CL-xxx`を参照し、回答を反映済み。

`blocking`な`open`または`answered`が1件でもあれば確定版は生成できない。`resolved`へ進めても
影響機能が同じ`CL-xxx`を参照しなければ品質エラーになる。

品質検査は「適切に」「必要に応じ」「速やかに」、代理者の決定方法、失敗時の再送回数・間隔・
終了条件といった代表的な曖昧さも検出する。誤検出を回避するため、単なるAPI要求の「再送」は
自動再試行とは扱わず、失敗・通知・送信の文脈にある再送だけを対象とする。

## 7. 品質レポート

品質レポートには以下を含む。

- `status`: `passed` / `failed`
- `blocking_error_count`
- `warning_count`
- `unresolved_count`
- `unsubstantiated_count`
- 規範要素種別ごとの`total`、`resolved`、`percent`
- `errors`、`warnings`

レポートはHTMLの「確認・品質情報」タブにも表示する。確定版は`status: passed`かつ
`blocking_error_count: 0`でなければならない。

## 8. HTML仕様

- Excel由来のteal系テーマ、セル結合、游ゴシック、stickyヘッダを維持する。
- 主表は分類3列、機能ID、機能名、概要、アクター、実行形態、根拠、提供状態とする。
- 機能IDから詳細カードへ移動できる。
- 機能一覧を文字列、状態、実行形態で絞り込める。
- タブへ`role=tablist/tab/tabpanel`、`aria-controls`、矢印キー操作を実装する。
- 表へ`caption`と`scope=col`を付ける。
- 印刷時は全タブをシート単位で出力する。

## 9. 旧形式の移行

v1 JSONと旧生成HTMLは`migrate_design.py`でv2ドラフトへ変換できる。

- 既存の分類、順序、文言、FR、画面参照を保持する。
- 文書順に`FNC-xxx`を仮付与する。
- v1に存在しないアクター、起動契機、入出力、条件、例外を`open_questions`へ追加する。
- specの全規範要素を抽出し、旧成果物で対応を判断できない項目を`unresolved`にする。
- ユーザー確認と補完が終わるまで確定版を生成しない。
