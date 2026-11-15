# baseline dc9d2c8 と v3 の比較

同じ注文API feature一式へ適用した固定15条件の結果:

| 候補 | 合格 | 合格率 | Developer | Programmer | Manager |
|---|---:|---:|---:|---:|---:|
| v3 | 15 / 15 | 100.0% | 5.0 / 5 | 4.5 / 5 | 4.5 / 5 |
| baseline | 1 / 15 | 6.7% | 2.0 / 5 | 1.5 / 5 | 1.5 / 5 |

baselineは機能・要求traceと自己完結HTMLには強い一方、構成、flow、状態、data、型付き契約、4軸準備度、
priority・risk・delivery俯瞰がない。v3はこれらを追加し、さらに入力成果物間の13件の未決事項を推測せず
`document_status: blocked`とした。これは「実装準備完了」を誤表示しない期待動作である。

独立graderは実行環境の利用上限で失敗したため、両候補へ同じ15条件を適用し、JSON/HTML構造、各checker、
決定的再生成の結果を根拠に採点した。
