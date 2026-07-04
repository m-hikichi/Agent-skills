---
marp: true
theme: technical
size: 16:9
paginate: true
html: true
---

<!-- _class: cover -->
<!-- _paginate: false -->

<div class="kicker">Hands-on training</div>

# 障害対応で「最初の15分」を再現可能にする

## ログ確認と切り分けの基礎

---

# 今日の到達点は、仮説を立てて次の確認を選べること

<div class="grid-3">
<div class="card primary"><h3>観測</h3><p>事実と推測を分ける</p></div>
<div class="card accent"><h3>仮説</h3><p>原因候補を優先順位化する</p></div>
<div class="card"><h3>検証</h3><p>最小の確認で候補を減らす</p></div>
</div>

---

# 最初に変更を加えず、時刻・範囲・症状を固定する

<div class="process">
<div class="step"><span class="step-no">01</span><h3>時刻</h3><p>いつから変化したか</p></div>
<div class="step"><span class="step-no">02</span><h3>範囲</h3><p>誰に何が起きたか</p></div>
<div class="step"><span class="step-no">03</span><h3>症状</h3><p>期待値との差は何か</p></div>
</div>

---

# ログはエラー行ではなく、その前後の因果候補を読む

<pre><code>10:02:11 request_id=7f2 latency=184ms status=200
10:02:13 deploy version=2.8.0 completed
10:02:16 request_id=81a latency=4200ms status=504</code></pre>

<div class="callout">観測: deploy直後から遅延。仮説: 新版が依存先タイムアウトを増やした。まだ原因確定ではない。</div>

---

# 仮説ごとに、否定できる最小の確認を選ぶ

<div class="compare">
<div class="before"><h2>避けたい確認</h2><p>大量のログを無目的に読む</p><p>複数設定を同時に変更する</p></div>
<div class="after"><h2>良い確認</h2><p>旧版との応答時間を比較する</p><p>依存先ごとの時間を測る</p></div>
</div>

---

# 演習: 次に確認する1項目を選ぶ

<div class="grid-2">
<div class="card primary"><h3>状況</h3><p>新版デプロイ3分後から、一部APIだけ504が増加した。</p></div>
<div class="card"><h3>回答形式</h3><p>仮説、確認項目、結果による次の分岐を書く。</p></div>
</div>

---

<!-- _class: closing -->

# 持ち帰るのは「観測 → 仮説 → 最小検証」の順序

変更は原因候補を狭めてから行い、各操作と結果を時系列で残す。
