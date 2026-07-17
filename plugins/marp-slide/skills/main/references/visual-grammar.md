# Visual grammar

視覚表現は装飾ではなく、主張を速く正確に読ませる文法である。

## Visual direction

制作前に次を1つの方針として記録する。

- palette: 背景、本文、強調、警告。色だけを意味の唯一の手掛かりにしない
- type: 日本語・英数字・コードのfont stackと、見出し／本文／注記の比率
- spacing: 外周余白、基準gap、密度の上限
- image treatment: crop、角、overlay、写真の色調
- motif: 線、番号、注釈、セクション記号など1〜2個
- density: `live | read-ahead | hybrid` に合わせた本文とnotesの分担

資料タイプからpaletteを自動決定しない。扱う内容、ブランド、聞き手、会場条件から選ぶ。

`brand_strictness`は、`strict`なら指定色・logo clear space・書体・画像処理をそのままhard constraintとして扱い、`guided`なら識別性を保った範囲でレイアウトへ適応し、`flexible`なら方向性の参考として扱う。どの水準でもロゴの変形や根拠のないブランド色追加はしない。

## 意味から表現を選ぶ

| 読み取らせる関係 | 第一候補 | 避けるもの |
|---|---|---|
| 1つの主張 | hero typography + 1 visual | 数字だけを巨大化して文脈を落とす |
| 実世界の状況 | full/half-bleed photo | 内容と無関係なstock photo |
| 量・順位の比較 | 共通0軸のbar/dot chart | CSS幅、3D、異なる単位の同一尺度 |
| 時間変化 | line/slope/timeline | 時間順でない矢印列 |
| 構成・依存 | diagram canvas | カードの羅列 |
| 2案の差 | before/afterまたは比較表 | 比較軸の不一致 |
| 不確実性 | interval/range + 注記 | 点推定だけの断定 |
| 詳細条件 | matrix/table | すべてを小カードに分割 |
| ケース | screenshot/photo + annotation | 読めない全画面キャプチャ |
| 引用・証言 | quote + source + 文脈 | 出典のない飾り引用 |

## レイアウトcatalog

- hero typography: thesis、判断、転換点
- full-bleed / half-bleed photo: 人、場所、製品、現場
- split image: visualと結論／条件を対応
- assertion + chart: 主張をタイトル、根拠を大きな図表にする
- diagram canvas: 構造やデータフローを静的SVGで見せる
- timeline: 時間、段階、依存関係を明示
- matrix / table: 同じ評価軸で複数項目を比較
- before / after: 対応する差だけを強調
- annotated screenshot: 読ませる箇所をcropし番号・矢印で示す
- quote / case study: 具体例をthesisへ接続
- section divider: 長い資料で認知上の区切りが必要なときだけ
- closing: 判断、演習、要点、未解決問いなど目的に合う終わり方

同じ構図が3枚続いたら、内容の関係により適した別表現がないか見直す。ただし、無関係なレイアウト変更で多様性を演出しない。

split coverの写真は`cover` cropでよいが、edge labelや画面全体が意味を持つ図解は`contain-visual`で全体を見せる。図表下にsourceや解釈注記を置く場合は`compact-visual`を使い、注記をfooterと競合させない。

## Visual briefの書き方

悪い例: `右にグラフ、左に説明`

良い例: `週別解約率の折れ線で第5週の急増を見せ、価格改定日と一致するが因果は未確定だと読ませる。第5週だけaccent、他週はneutral。`

visual briefには、対象、関係、注目点、読み取る結論、不確実性、出典を含める。

## 可読性

- 16:9全体を1つの構図として設計し、外周に安全余白を置く
- title、主役、補足、sourceの順が距離を置いても分かるようにする
- 本文を縮める前に、要約、分割、notes、appendixを使う
- 写真上の文字はcontrast overlayか空き領域を使う
- altは「図」「グラフ」でなく、重要な傾向または役割を書く
