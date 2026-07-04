---
marp: true
theme: editorial
size: 16:9
paginate: true
html: true
---

<!-- _class: cover -->
<!-- _paginate: false -->

<div class="kicker">Research example / synthetic data</div>

# 週4日勤務は生産性を維持できるか

## 12週間の試行結果と解釈

---

# 結論は「条件付きで維持」、確信度は中程度

<p class="lede">定型業務では成果量を維持した一方、顧客対応の初動は遅くなった。全社導入には勤務日のカバレッジ設計が必要。</p>

<div class="callout"><strong>確信度が中程度の理由:</strong> 対照群がなく、繁閑差の影響を除き切れていない。</div>

---

# 試行は3チーム84人を対象に、開始前後12週間を比較した

<div class="grid-3">
<div class="card primary"><h3>対象</h3><p>開発・運用・顧客支援</p></div>
<div class="card accent"><h3>期間</h3><p>前後各12週間</p></div>
<div class="card"><h3>指標</h3><p>成果量、品質、初動時間</p></div>
</div>

<p class="source">合成データによる構成例。実研究では選定基準、欠損、除外条件を記載する。</p>

---

# 成果量と品質は維持されたが、初動時間は悪化した

<div class="metrics">
<div class="metric highlight"><span class="value">+1.8%</span><span class="label">成果量</span></div>
<div class="metric"><span class="value">-0.4pt</span><span class="label">欠陥率</span></div>
<div class="metric"><span class="value">+23分</span><span class="label">顧客初動</span></div>
</div>

<p class="source">合成データ: 試行前後の平均との差。統計的不確実性は次ページで扱う。</p>

---

# 成果量の変化は、ゼロ付近の幅広い範囲と整合する

<div class="visual">

![w:860](assets/research-interval.svg)

</div>

<p class="source">合成データ: 95%区間。SVGはローカルアセットとして管理。</p>

---

# 観測結果だけでは、勤務日数が原因とは断定できない

<div class="grid-2">
<div class="card primary"><h2>支持する材料</h2><p>3チームで成果量の大幅低下は観測されなかった。</p></div>
<div class="card accent"><h2>代替説明</h2><p>試行期間の案件構成、参加者選択、繁閑差が影響した可能性がある。</p></div>
</div>

---

<!-- _class: closing -->

# 次の問いは、カバレッジ設計で初動遅延を解消できるか

対照群を設けた追加試行で、顧客初動と従業員負荷を同時に検証する。
