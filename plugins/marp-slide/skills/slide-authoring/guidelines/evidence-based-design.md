# 根拠に基づく説明・デザイン

制作前に適用する原則を選び、レビュー時に成果物で確認する。研究上の原則と実務上の目安を区別し、文字数・秒数を普遍的な法則にしない。以下は公開論文・著者サイト・書籍の公開抜粋との対応であり、書籍全文の再掲ではない。

| 原則・根拠 | 適用する場面と操作 | 例外・注意 | 悪い例 → 良い例 | 確認担当 |
|---|---|---|---|---|
| 主張＋視覚的根拠 [S1] | 主張ページは結論を文章の見出しにし、図表で支える | 方法・演習・区切りは問いや役割を優先。断定を強めない | 「売上分析」→「既存顧客の更新が増収の主因」＋内訳図 | content / audience |
| 不要情報の除去（一貫性）[S2] | 理解や判断に寄与しない装飾・文・図を削る | 条件・不確実性・反証は残す。簡潔さのために根拠を消さない | 無関係な握手写真 → 比較に必要な図のみ | visual |
| 注目点の明示（シグナリング）[S2] | 注目箇所に色・線・番号・短い注釈を使う | 色だけで区別しない。対照データも必要なら残す | 全系列を原色 → 対象系列を強調し直接ラベル | visual / audience |
| 空間的近接 [S2] | 説明を対応する図の部分へ置き、凡例との往復を減らす | 混雑する場合は番号対応や小分け図を使う | 離れた凡例 → 線の終点に系列名 | visual |
| 分節化 [S2] | 複雑な内容を全体→部分→統合へ分ける。ページ間で位置・色を保持 | 研究の自己ペース学習条件と登壇は同一ではない。文脈を失う細分化は避ける | 大きなフローを一括提示 → 全体図＋同じ座標の段階別説明 | content / audience |
| 事前訓練 [S2] | 初心者には主要用語・部品・役割を動作説明より先に示す | 熟練者には不要な基礎説明を増やさない | 略語だらけの構成図 → 部品の短い説明の後に接続図 | content |
| 冗長性への配慮 [S2] | live/hybridでは画面の要点・図と口頭説明を分担する | read-ahead、字幕、引用、式、必要な用語は保持。文字の全面禁止ではない | 長文をそのまま朗読 → 要点と図＋補足notes | content |
| 余白・対比・反復・整列・近接 [S3] | 意味のまとまり内を近く、まとまり間を広くする。共通軸・書体階層・意味色を反復 | 多様性のためだけに配置を変えない | 関連の異なる項目が等間隔 → 関連ごとにまとまりと余白 | visual |
| 図表の整理 [S4] | 不要な枠・目盛線・小数桁を抑え、必要な値を直接表示。ラベルは水平を優先 | 正確な値の比較に必要な軸・目盛は残す | 濃い格子＋多数の値 → 薄い補助線＋重要値のみ | visual |
| Glance Test [S5] | live/hybridの主要ページは短い初見で主題と注目点を答えられるか試す | 約3秒は実務の目安。read-aheadの精読には適用しない。AIの画像読解は実測3秒テストではない | 制作意図を先に説明 → 完成画像だけで理解を記録 | audience |

## 制作と確認

- deck planの各ページに主張、前提知識、推定説明時間、理解確認の問いを記録する。目的の異なる主張が同居したら分割し、根拠不足を枚数増加で隠さない。
- 同じ対象は同じ呼称・色・位置で示す。段階表示は静的ページで実現し、全体図へ戻れるようにする。
- 図の注釈と対象の距離、まとまり内外の間隔、軸・小数桁・凡例の必要性をvisual reviewerが説明できる状態にする。
- audience reviewerの初見記録を先に固定し、その後content reviewerが意図と照合する。実際の対象読者による理解テストの代用と断定しない。

## 出典と適用範囲

- **S1** Michael Alleyら、Assertion–Evidence approach（技術発表の主張と視覚的根拠）: https://www.assertion-evidence.org/ ／研究一覧 https://writing.engr.psu.edu/research.html
- **S2** Richard E. Mayer, “Using multimedia for e-learning”, 2017: https://doi.org/10.1111/jcal.12197 。『Multimedia Learning』第3版の出版社紹介: https://www.cambridge.org/highereducation/books/multimedia-learning/FB7E79A165D24D47CEACEB4D2C426ECD 。主に学習環境の研究であり、営業・経営資料への応用効果を同一視しない。
- **S3** Garr Reynolds, 『Presentation Zen』第6章、著者公開抜粋: https://www.presentationzen.com/chapter6_spread.pdf 。実務上のデザイン指針。
- **S4** Storytelling with Data, “declutter! (and question default settings)”: https://www.storytellingwithdata.com/blog/2019/5/13/declutter-and-question-defaults 。図表の具体的な改善例。
- **S5** Duarte, The Glance Test: https://www.duarte.com/resources/guides-tools/the-glance-test/ 。短時間での主題把握を確かめる実務的手法。

公開資料照合日: 2026-10-17。図版・文章を複製する場合は別途権利を確認する。
