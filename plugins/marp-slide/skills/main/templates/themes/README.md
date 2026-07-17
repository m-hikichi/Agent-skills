# Theme system

最終レンダーには必ず自己完結した `slides/theme.css` を1つ渡す。workspaceの任意configや外部CSSを自動読込しない。

## Compile inputs

1. `src/base.css` — 16:9 canvas、余白、共通レイアウト、table、quote、code
2. `src/profiles/<profile>.css` — palette、font、surface、profile固有の調整
3. `src/deck-tokens.template.css` — そのデッキだけのtokenと必要最小限のclass

新しい `slides/theme.css` の先頭へ、固有theme名とMarp既定theme importを書く。

```css
/* @theme project-topic */
@import 'default';
```

続けてbase、選択したprofile、deck tokensの順に内容を連結する。`@theme`は最終ファイルに1つだけ置く。deck tokensでは色違いを作るだけでなく、承認済みvisual directionを具体化する。

## Profiles

- `executive.css`: 意思決定、経営更新。短い主張と強い比較
- `analytical.css`: read-ahead、報告、研究。注記と表を含む高い情報密度
- `technical.css`: 研修、アーキテクチャ。code、diagram、演習

資料タイプだけでprofileを決めない。ブランド、聞き手、delivery mode、素材との整合で選ぶ。

`split` coverで写真を端まで見せる場合は既定の`object-fit: cover`を使う。図解や画面mockの全体が意味を持つ場合は`cover split contain-visual`を指定し、edge labelをcropしない。chart／diagramの下に注記が必要なページは`compact-visual`でvisualを縮め、footer領域へ注記を押し出さない。

## Standalone examples

ルートにある `executive-clean.css`, `editorial.css`, `technical.css` は既存利用者向けの自己完結例で、そのまま `slides/theme.css` にコピーできる。gold deckの再現や互換確認に使い、新規デッキではcompile inputsから固有themeを作る。

## 禁止事項

- frontmatterのHTML実行許可を前提にした部品
- runtime JavaScript、外部font/CSS/SVG参照
- HTML要素の幅指定で描く疑似chart
- 1ページの装飾だけのために増殖するclass
