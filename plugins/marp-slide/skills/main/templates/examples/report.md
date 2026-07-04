---
marp: true
theme: editorial
size: 16:9
paginate: true
html: true
---

<!-- _class: cover -->
<!-- _paginate: false -->

<div class="kicker">Analysis report / demo data</div>

# 解約増加の主因は価格ではなく初期設定の遅れだった

## 2026年第2四半期 顧客分析報告

---

# 分析は新規契約1,240社の利用ログと退会理由を対象にした

<div class="grid-2">
<div class="card primary"><h2>対象</h2><p>2026年1〜3月に契約した1,240社</p></div>
<div class="card accent"><h2>方法</h2><p>利用ログ、サポート履歴、退会アンケートを結合</p></div>
</div>

<p class="source">デモデータ: 分析例。実資料では抽出条件と欠損処理を記載する。</p>

---

# 初週に設定を完了した顧客は、90日継続率が25pt高い

<div class="metrics">
<div class="metric highlight"><span class="value">82%</span><span class="label">初週完了群</span></div>
<div class="metric"><span class="value">57%</span><span class="label">未完了群</span></div>
<div class="metric"><span class="value">+25pt</span><span class="label">継続率差</span></div>
</div>

<p class="source">デモデータ: 90日継続率、n=1,240。相関であり因果を直接示さない。</p>

---

# 価格を挙げた解約者でも、半数は設定未完了だった

<div class="bar-chart">
<div class="bar"><span class="bar-label">設定未完了</span><span class="bar-track"><span class="bar-fill accent" style="display:block;width:54%"></span></span><span class="bar-value">54%</span></div>
<div class="bar"><span class="bar-label">利用定着済み</span><span class="bar-track"><span class="bar-fill" style="display:block;width:31%"></span></span><span class="bar-value">31%</span></div>
<div class="bar"><span class="bar-label">判定不能</span><span class="bar-track"><span class="bar-fill" style="display:block;width:15%"></span></span><span class="bar-value">15%</span></div>
</div>

<p class="source">デモデータ: 「価格」を選択した退会者198社の設定状況</p>

---

# 改善対象は値引きではなく、契約後7日間の支援にある

<div class="callout">初週の設定完了を先行指標とし、ガイド、通知、有人支援をこの期間へ集中する。</div>

<div class="grid-2">
<div class="card"><h3>次に検証すること</h3><p>支援施策が設定完了率を改善するか</p></div>
<div class="card"><h3>まだ言えないこと</h3><p>設定完了が継続率を因果的に上げるか</p></div>
</div>

---

<!-- _class: closing -->

# 次四半期は初週支援の実験で因果効果を確認する

対象群と対照群を設け、設定完了率と90日継続率を追跡する。
