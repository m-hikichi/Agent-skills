---
marp: true
theme: gaia
header: ""
footer: ""
size: 16:9
paginate: true
html: true
style: |
  @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0');

  :root {
    --bg-main: #0b1324;
    --bg-deep: #060c17;
    --bg-hero: #07111f;
    --bg-card: rgba(13, 24, 43, 0.88);
    --bg-soft: rgba(16, 29, 50, 0.66);
    --bg-flat: rgba(255, 255, 255, 0.04);
    --accent: #43d3ff;
    --accent-soft: #b4f3ff;
    --accent-gold: #ffbf47;
    --accent-mint: #35d399;
    --accent-warn: #ff8a7d;
    --text-main: #f8fbff;
    --text-sub: #d4deee;
    --text-muted: #91a0bc;
    --border-soft: rgba(156, 214, 255, 0.16);
    --border-quiet: rgba(255, 255, 255, 0.08);
    --radius-lg: 22px;
    --shadow-card: 0 14px 30px rgba(0, 0, 0, 0.22);
    --shadow-panel: 0 10px 20px rgba(0, 0, 0, 0.14);
    --font-title: "BIZ UDPGothic", "Yu Gothic UI", "Segoe UI", sans-serif;
    --font-body: "Aptos", "Hiragino Sans", "Yu Gothic UI", sans-serif;
    --font-min: 24px;
  }

  section {
    justify-content: start;
    position: relative;
    padding: 80px 80px 104px;
    background:
      radial-gradient(circle at top right, rgba(67, 211, 255, 0.07) 0, rgba(67, 211, 255, 0) 32%),
      linear-gradient(180deg, #101b31 0%, #091220 100%);
    color: var(--text-main);
    font-family: var(--font-body);
    font-size: 27px;
    line-height: 1.42;
  }

  section::before {
    content: "";
    position: absolute;
    inset: 16px;
    border: 1px solid rgba(150, 196, 255, 0.06);
    border-radius: 28px;
    pointer-events: none;
  }

  header,
  footer {
    display: none;
  }

  section::after {
    content: attr(data-marpit-pagination) " / " attr(data-marpit-pagination-total);
    position: absolute;
    right: 26px;
    bottom: 16px;
    font-size: max(0.7em, var(--font-min));
    color: var(--text-muted);
  }

  h1,
  h2,
  h3 {
    margin: 0;
    font-family: var(--font-title);
    color: var(--text-main);
  }

  h2 {
    font-size: 1.45em;
    margin-bottom: 24px;
    padding-bottom: 14px;
    position: relative;
    line-height: 1.24;
  }

  h2::after {
    content: "";
    position: absolute;
    left: 0;
    bottom: 0;
    width: clamp(120px, 30%, 260px);
    height: 3px;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--accent), rgba(67, 211, 255, 0.16));
  }

  h3 {
    font-size: max(0.82em, var(--font-min));
    margin-bottom: 8px;
    color: var(--accent-soft);
  }

  p,
  li {
    color: var(--text-sub);
  }

  ul {
    margin: 0.28em 0 0 1em;
    padding: 0;
  }

  li {
    margin: 0.18em 0;
  }

  strong {
    color: var(--text-main);
  }

  code {
    font-family: "Cascadia Code", "Consolas", monospace;
    background: rgba(3, 10, 24, 0.94);
    color: #dff7ff;
    padding: 0.08em 0.24em;
    border-radius: 6px;
    font-size: max(0.82em, var(--font-min));
  }

  pre {
    margin: 0.22em 0 0;
    padding: 16px 18px;
    border-radius: 18px;
    background: rgba(3, 10, 24, 0.94);
    border: 1px solid var(--border-soft);
    box-shadow: var(--shadow-card);
    font-size: max(0.54em, var(--font-min));
    line-height: 1.34;
  }

  pre code {
    background: transparent;
    color: inherit;
    padding: 0;
    font-size: 1em;
  }

  .icon {
    font-family: "Material Symbols Outlined";
    font-weight: normal;
    font-style: normal;
    font-size: 1em;
    line-height: 1;
    letter-spacing: normal;
    text-transform: none;
    display: inline-block;
    white-space: nowrap;
    direction: ltr;
    -webkit-font-smoothing: antialiased;
    font-variation-settings: "FILL" 0, "wght" 300, "GRAD" 0, "opsz" 24;
  }

  .icon-inline {
    margin-right: 0.18em;
    vertical-align: -0.18em;
    color: var(--accent-soft);
  }

  .icon-box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: 46px;
    border-radius: 14px;
    background: rgba(67, 211, 255, 0.12);
    color: var(--accent-soft);
    border: 1px solid rgba(180, 243, 255, 0.16);
    flex-shrink: 0;
  }

  .panel-head {
    display: grid;
    grid-template-columns: 46px 1fr;
    gap: 14px;
    align-items: start;
    margin-bottom: 12px;
  }

  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
  }

  .grid-3 {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }

  .grid-4 {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
  }

  .grid-5 {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 12px;
  }

  .stack {
    display: grid;
    gap: 16px;
  }

  .card {
    background: var(--bg-card);
    border: 1px solid var(--border-soft);
    border-left: 4px solid var(--accent);
    border-radius: var(--radius-lg);
    padding: 18px 20px;
    box-shadow: var(--shadow-card);
  }

  .card p {
    margin: 0.15em 0 0;
    font-size: max(0.8em, var(--font-min));
  }

  .soft {
    background: var(--bg-soft);
  }

  .gold {
    border-left-color: var(--accent-gold);
  }

  .mint {
    border-left-color: var(--accent-mint);
  }

  .warn {
    border-left-color: var(--accent-warn);
  }

  .pill {
    display: inline-block;
    margin-bottom: 10px;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(67, 211, 255, 0.12);
    color: var(--accent-soft);
    font-size: max(0.48em, var(--font-min));
    letter-spacing: 0.06em;
  }

  .banner {
    margin-top: 14px;
    padding: 12px 16px;
    border-radius: 16px;
    background: rgba(9, 19, 38, 0.56);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-left: 3px solid rgba(67, 211, 255, 0.4);
    color: var(--text-sub);
    font-size: max(0.74em, var(--font-min));
  }

  .agenda-list {
    display: grid;
    gap: 12px;
    margin-top: 8px;
  }

  .agenda-list.two-column {
    grid-template-columns: 1fr 1fr;
    gap: 14px 16px;
  }

  .agenda-item {
    display: grid;
    grid-template-columns: 52px 1fr;
    gap: 14px;
    align-items: start;
    padding: 14px 16px;
    border-radius: 18px;
    background: rgba(10, 20, 38, 0.58);
    border: 1px solid var(--border-soft);
  }

  .agenda-item h3 {
    margin-bottom: 6px;
  }

  .agenda-item p {
    margin: 0;
    font-size: var(--font-min);
    line-height: 1.32;
  }

  .agenda-item .pill {
    margin-bottom: 8px;
  }

  .content-panel {
    padding: 20px 22px;
    border-radius: 22px;
    border: 1px solid var(--border-soft);
  }

  .content-panel.flat {
    background: var(--bg-flat);
    border-left: 4px solid rgba(67, 211, 255, 0.45);
    box-shadow: none;
  }

  .content-panel.dual {
    background: rgba(10, 20, 38, 0.82);
    box-shadow: var(--shadow-panel);
  }

  .content-panel h3 {
    margin-bottom: 8px;
  }

  .content-panel ul {
    margin-top: 0.1em;
  }

  .quiet-note {
    margin-top: 10px;
    color: var(--text-muted);
    font-size: max(0.62em, var(--font-min));
    line-height: 1.45;
  }

  .tiny {
    color: #b8c7df;
    font-size: max(0.52em, var(--font-min));
    line-height: 1.45;
  }

  .micro {
    color: #9aa9c4;
    font-size: max(0.42em, var(--font-min));
    line-height: 1.4;
  }

  .flow {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 12px;
    align-items: stretch;
  }

  .step {
    position: relative;
  }

  .step::after {
    content: "";
    position: absolute;
    top: 50%;
    right: -10px;
    width: 8px;
    height: 8px;
    border-top: 2px solid rgba(180, 243, 255, 0.7);
    border-right: 2px solid rgba(180, 243, 255, 0.7);
    transform: translateY(-50%) rotate(45deg);
  }

  .flow > :last-child::after {
    display: none;
  }

  .big-stat {
    font-family: var(--font-title);
    font-size: 3.8em;
    font-weight: 700;
    line-height: 0.92;
    color: var(--accent-soft);
    margin-bottom: 8px;
  }

  .big-sub {
    color: var(--text-main);
    font-size: max(0.88em, var(--font-min));
    margin-bottom: 20px;
  }

  section.title-hero,
  section.section-divider {
    background:
      radial-gradient(circle at top right, rgba(67, 211, 255, 0.12) 0, rgba(67, 211, 255, 0) 34%),
      radial-gradient(circle at bottom left, rgba(255, 191, 71, 0.1) 0, rgba(255, 191, 71, 0) 26%),
      linear-gradient(135deg, #112347 0%, #09152a 42%, #050c18 100%);
  }

  section.title-hero {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
  }

  section.title-hero h1 {
    font-size: 1.72em;
    line-height: 1.14;
    margin-bottom: 18px;
  }

  section.title-hero h2 {
    padding-bottom: 0;
    margin-bottom: 0;
    color: var(--text-sub);
    font-size: max(0.82em, var(--font-min));
    max-width: 1080px;
    margin-left: auto;
    margin-right: auto;
  }

  section.title-hero h2::after {
    display: none;
  }

  section.title-hero .hero-note {
    margin-top: 24px;
    color: var(--text-muted);
    font-size: max(0.68em, var(--font-min));
  }

  section.title-hero::after {
    display: none;
  }

  section.agenda-overview .banner,
  section.title-content .banner {
    background: rgba(9, 19, 38, 0.44);
  }

  section.agenda-overview h2 {
    margin-bottom: 20px;
  }

  section.agenda-overview .banner {
    margin-top: 14px;
    padding: 12px 16px;
    line-height: 1.34;
  }

  section.title-content .content-panel.flat {
    max-width: 980px;
  }

  section.two-column-content .content-panel.dual {
    min-height: 250px;
  }

  section.section-divider {
    justify-content: center;
    align-items: flex-start;
    padding: 86px 96px;
    text-align: left;
  }

  section.section-divider::after {
    display: none;
  }

  section.section-divider h2 {
    font-size: 2.4em;
    margin-bottom: 12px;
  }

  section.section-divider h2::after {
    width: clamp(160px, 28%, 220px);
    height: 5px;
    background: linear-gradient(90deg, var(--accent-gold), rgba(255, 191, 71, 0.14));
  }

  section.section-divider .section-kicker {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(255, 191, 71, 0.16);
    color: #ffe1a8;
    font-size: max(0.5em, var(--font-min));
    letter-spacing: 0.14em;
  }

  section.section-divider .subline {
    max-width: 880px;
    font-size: max(0.94em, var(--font-min));
    color: var(--text-main);
  }

  section.section-divider .section-note {
    margin-top: 22px;
    max-width: 820px;
    padding: 14px 18px;
    border-left: 4px solid var(--accent-gold);
    border-radius: 16px;
    background: rgba(9, 19, 38, 0.68);
    color: var(--text-sub);
    font-size: max(0.72em, var(--font-min));
  }

  section.architecture-diagram .diagram {
    display: grid;
    grid-template-columns: 1.15fr 0.95fr;
    gap: 18px;
  }

  section.architecture-diagram .node-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  section.big-number .grid-5 .card p,
  section.timeline-roadmap .grid-5 .card p {
    font-size: max(0.72em, var(--font-min));
  }

  section.closing-next-action .sources {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  section.closing-next-action .stack {
    gap: 12px;
  }

  section.closing-next-action .card {
    padding: 14px 18px;
  }

  section.closing-next-action h3 {
    margin-bottom: 6px;
  }

  section.closing-next-action .micro {
    font-size: var(--font-min);
  }
---

<!-- _class: title-hero -->
<!-- _paginate: false -->
<!-- _header: "" -->
<!-- _footer: "" -->

# Put the decision-worthy message here
## Reuse the bundled visual direction while replacing all topic-specific copy

<p class="hero-note"><span class="icon icon-inline">auto_awesome</span>Subtitle, audience cue, or source note</p>

---

## Lead with the outcome and make the deck scan fast

<div class="grid-3">
<div class="card">
<div class="pill"><span class="icon icon-inline">flag</span>Outcome</div>
<h3>State one result</h3>
<p>Keep each card short and decision-oriented.</p>
</div>
<div class="card mint">
<div class="pill"><span class="icon icon-inline">insights</span>Evidence</div>
<h3>Show what supports it</h3>
<p>Prefer numbers, contrasts, or proof over generic bullets.</p>
</div>
<div class="card gold">
<div class="pill"><span class="icon icon-inline">arrow_outward</span>Action</div>
<h3>Tell the audience what follows</h3>
<p>Make the next move explicit before the detail slides start.</p>
</div>
</div>

<div class="banner">Treat this file as a <strong>visual template deck</strong>: reuse palette, spacing, card language, and divider treatment while replacing every content block with the new story.</div>

---

<!-- _class: agenda-overview -->

## Use an agenda only when it improves navigation

<div class="agenda-list two-column">
<div class="agenda-item">
<div class="icon-box"><span class="icon">explore</span></div>
<div>
<div class="pill">01</div>
<h3>Context</h3>
<p>Set the context.</p>
</div>
</div>
<div class="agenda-item">
<div class="icon-box"><span class="icon">dashboard</span></div>
<div>
<div class="pill">02</div>
<h3>Main discussion</h3>
<p>Name the core topic.</p>
</div>
</div>
<div class="agenda-item">
<div class="icon-box"><span class="icon">view_timeline</span></div>
<div>
<div class="pill">03</div>
<h3>Evidence and options</h3>
<p>Show proof and choices.</p>
</div>
</div>
<div class="agenda-item">
<div class="icon-box"><span class="icon">task_alt</span></div>
<div>
<div class="pill">04</div>
<h3>Recommendation</h3>
<p>Close with the ask.</p>
</div>
</div>
</div>

<div class="banner">Use 1 column for 3 items and 2 columns for 4-5.</div>

---

<!-- _class: title-content -->

## Use one title with one dominant content block when the message is singular

<div class="content-panel flat">
<div class="panel-head">
<div class="icon-box"><span class="icon">article</span></div>
<div>
<div class="pill">Main content</div>
<h3>Explain the point without overfilling the slide</h3>
</div>
</div>
<ul>
<li>Use up to <strong>three</strong> bullets or one compact diagram.</li>
<li>Keep the bullets supportive, not repetitive.</li>
<li>Leave enough empty space that the eye knows where to start.</li>
</ul>
<div class="quiet-note">This archetype should feel quieter than hero slides or comparison slides. Use it as the steady baseline of the deck.</div>
</div>

---

<!-- _class: two-column-content -->

## Place two related content blocks side by side when both deserve equal weight

<div class="grid-2">
<div class="content-panel dual">
<div class="panel-head">
<div class="icon-box"><span class="icon">group_work</span></div>
<div>
<div class="pill">Left column</div>
<h3>First content block</h3>
</div>
</div>
<ul>
<li>Keep the subhead short.</li>
<li>Use two or three points at most.</li>
<li>Match the density of the other side.</li>
</ul>
</div>
<div class="content-panel dual">
<div class="panel-head">
<div class="icon-box"><span class="icon">bolt</span></div>
<div>
<div class="pill">Right column</div>
<h3>Second content block</h3>
</div>
</div>
<ul>
<li>Use parallel structure when possible.</li>
<li>Keep column heights visually balanced.</li>
<li>Reserve `two-column-compare` for explicit A vs B stories.</li>
</ul>
</div>
</div>

<div class="banner">Give this archetype a stronger panel treatment than `title-content` so the reader immediately understands that the slide has two equal reading tracks.</div>

---

<!-- _class: section-divider -->
<!-- _header: "" -->
<!-- _footer: "" -->

<div class="section-kicker"><span class="icon">layers</span>SECTION</div>
<h2>Use strong divider moments</h2>

<p class="subline">Medium and long decks should visibly change rhythm between sections.</p>
<p class="section-note">Use this layout for chapter changes, not for regular content pages.</p>

---

<!-- _class: closing-next-action -->

## End with the action, owner, or decision request

<div class="grid-2">
<div class="stack">
<div class="card"><h3><span class="icon icon-inline">flag</span>Decision</h3><p>Name the recommendation clearly.</p></div>
<div class="card"><h3><span class="icon icon-inline">person</span>Owner</h3><p>Show who acts next.</p></div>
<div class="card gold"><h3><span class="icon icon-inline">event</span>Timing</h3><p>State the next milestone or deadline.</p></div>
</div>
<div class="stack">
<div class="card mint">
<h3><span class="icon icon-inline">track_changes</span>Takeaway</h3>
<p>Summarize the one thing the audience should remember.</p>
</div>
<div class="micro sources">
Sources or footnotes go here when needed.
</div>
</div>
</div>
