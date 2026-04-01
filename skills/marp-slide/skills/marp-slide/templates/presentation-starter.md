---
marp: true
theme: gaia
header: ""
footer: ""
size: 16:9
paginate: true
html: true
style: |

  /* ============================================================
     DESIGN TOKENS
     ============================================================ */

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
    --accent-purple: #a78bfa;
    --text-main: #f8fbff;
    --text-sub: #d4deee;
    --text-muted: #91a0bc;
    --border-soft: rgba(156, 214, 255, 0.16);
    --border-quiet: rgba(255, 255, 255, 0.08);
    --radius-lg: 22px;
    --radius-md: 16px;
    --radius-sm: 10px;
    --shadow-card: 0 14px 30px rgba(0, 0, 0, 0.22);
    --shadow-panel: 0 10px 20px rgba(0, 0, 0, 0.14);
    --font-title: "BIZ UDPGothic", "Yu Gothic UI", "Segoe UI", sans-serif;
    --font-body: "Aptos", "Hiragino Sans", "Yu Gothic UI", sans-serif;
  }

  /* ============================================================
     BASE SECTION
     ============================================================ */

  section {
    justify-content: start;
    position: relative;
    padding: 76px 80px 100px;
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

  header, footer { display: none; }

  section::after {
    content: attr(data-marpit-pagination) " / " attr(data-marpit-pagination-total);
    position: absolute;
    right: 26px;
    bottom: 16px;
    font-size: 0.56em;
    color: var(--text-muted);
  }

  /* ============================================================
     TYPOGRAPHY
     ============================================================ */

  h1, h2, h3 { margin: 0; font-family: var(--font-title); color: var(--text-main); }

  h2 {
    font-size: 1.45em;
    margin-bottom: 22px;
    padding-bottom: 14px;
    position: relative;
    line-height: 1.24;
  }

  h2::after {
    content: "";
    position: absolute;
    left: 0; bottom: 0;
    width: clamp(120px, 30%, 260px);
    height: 3px;
    border-radius: 999px;
    background: linear-gradient(90deg, var(--accent), rgba(67, 211, 255, 0.16));
  }

  h3 { font-size: 0.82em; margin-bottom: 8px; color: var(--accent-soft); }
  p, li { color: var(--text-sub); }
  ul { margin: 0.28em 0 0 1em; padding: 0; }
  li { margin: 0.18em 0; }
  strong { color: var(--text-main); }

  code {
    font-family: "Cascadia Code", "Consolas", monospace;
    background: rgba(3, 10, 24, 0.94);
    color: #dff7ff;
    padding: 0.08em 0.24em;
    border-radius: 6px;
    font-size: 0.82em;
  }

  pre {
    margin: 0.22em 0 0; padding: 16px 18px; border-radius: 18px;
    background: rgba(3, 10, 24, 0.94); border: 1px solid var(--border-soft);
    box-shadow: var(--shadow-card); font-size: 0.58em; line-height: 1.34;
  }
  pre code { background: transparent; color: inherit; padding: 0; font-size: 1em; }

  /* ============================================================
     EMOJI ICON UTILITIES
     外部フォント不要。Docker / オフライン環境でも確実に表示。
     ============================================================ */

  .e { font-style: normal; font-size: 1em; line-height: 1; margin-right: 0.14em; vertical-align: -0.06em; }

  .icon-box {
    display: inline-flex; align-items: center; justify-content: center;
    width: 46px; height: 46px; border-radius: 14px;
    background: rgba(67, 211, 255, 0.12); color: var(--accent-soft);
    border: 1px solid rgba(180, 243, 255, 0.16); flex-shrink: 0; font-size: 1.3em;
  }

  /* ============================================================
     LAYOUT UTILITIES
     ============================================================ */

  .panel-head { display: grid; grid-template-columns: 46px 1fr; gap: 14px; align-items: start; margin-bottom: 12px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
  .stack  { display: grid; gap: 16px; }

  /* ============================================================
     CARD / PANEL
     ============================================================ */

  .card {
    background: var(--bg-card); border: 1px solid var(--border-soft);
    border-left: 4px solid var(--accent); border-radius: var(--radius-lg);
    padding: 18px 20px; box-shadow: var(--shadow-card);
  }
  .card p    { margin: 0.15em 0 0; font-size: 0.8em; }
  .card.soft { background: var(--bg-soft); }
  .card.gold { border-left-color: var(--accent-gold); }
  .card.mint { border-left-color: var(--accent-mint); }
  .card.warn { border-left-color: var(--accent-warn); }

  .content-panel { padding: 20px 22px; border-radius: var(--radius-lg); border: 1px solid var(--border-soft); }
  .content-panel.flat { background: var(--bg-flat); border-left: 4px solid rgba(67, 211, 255, 0.45); box-shadow: none; }
  .content-panel.dual { background: rgba(10, 20, 38, 0.82); box-shadow: var(--shadow-panel); }
  .content-panel h3 { margin-bottom: 8px; }
  .content-panel ul  { margin-top: 0.1em; }

  /* ============================================================
     PILLS / BANNERS / NOTES
     ============================================================ */

  .pill {
    display: inline-block; margin-bottom: 10px; padding: 4px 10px;
    border-radius: 999px; background: rgba(67, 211, 255, 0.12);
    color: var(--accent-soft); font-size: 0.52em; letter-spacing: 0.06em;
  }

  .banner {
    margin-top: 14px; padding: 12px 16px; border-radius: var(--radius-md);
    background: rgba(9, 19, 38, 0.56); border: 1px solid rgba(255, 255, 255, 0.06);
    border-left: 3px solid rgba(67, 211, 255, 0.4); color: var(--text-sub); font-size: 0.74em;
  }

  .quiet-note { margin-top: 10px; color: var(--text-muted); font-size: 0.64em; line-height: 1.45; }
  .tiny  { color: #b8c7df; font-size: 0.56em; line-height: 1.45; }
  .micro { color: #9aa9c4; font-size: 0.48em; line-height: 1.4; }

  /* ============================================================
     AGENDA
     ============================================================ */

  .agenda-list { display: grid; gap: 12px; margin-top: 8px; }
  .agenda-list.two-column { grid-template-columns: 1fr 1fr; gap: 14px 16px; }

  .agenda-item {
    display: grid; grid-template-columns: 52px 1fr; gap: 14px; align-items: start;
    padding: 14px 16px; border-radius: 18px;
    background: rgba(10, 20, 38, 0.58); border: 1px solid var(--border-soft);
  }
  .agenda-item h3 { margin-bottom: 6px; }
  .agenda-item p  { margin: 0; font-size: 0.78em; line-height: 1.32; }
  .agenda-item .pill { margin-bottom: 8px; }

  /* ============================================================
     PROCESS FLOW
     ============================================================ */

  .flow { display: grid; gap: 28px; align-items: stretch; position: relative; }
  .flow.cols-3 { grid-template-columns: repeat(3, 1fr); }
  .flow.cols-4 { grid-template-columns: repeat(4, 1fr); }
  .flow.cols-5 { grid-template-columns: repeat(5, 1fr); }

  .step {
    position: relative; background: var(--bg-card); border: 1px solid var(--border-soft);
    border-radius: var(--radius-lg); padding: 18px 16px;
    box-shadow: var(--shadow-card); text-align: center;
  }
  .step h3 { text-align: center; margin-bottom: 6px; }
  .step p  { margin: 0; font-size: 0.76em; text-align: center; }

  .step::after {
    content: "\25B8";
    position: absolute; top: 50%; right: -20px; transform: translateY(-50%);
    font-size: 1.2em; color: var(--accent-soft); z-index: 1;
  }
  .flow > :last-child::after { display: none; }

  .step-number {
    display: inline-flex; align-items: center; justify-content: center;
    width: 36px; height: 36px; border-radius: 50%;
    background: rgba(67, 211, 255, 0.18); color: var(--accent-soft);
    font-family: var(--font-title); font-size: 0.72em; font-weight: 700; margin-bottom: 10px;
  }

  /* ============================================================
     TIMELINE / ROADMAP
     ============================================================ */

  .timeline { display: grid; gap: 14px; }
  .timeline.cols-3 { grid-template-columns: repeat(3, 1fr); }
  .timeline.cols-4 { grid-template-columns: repeat(4, 1fr); }
  .timeline.cols-5 { grid-template-columns: repeat(5, 1fr); }

  .milestone {
    background: var(--bg-card); border: 1px solid var(--border-soft);
    border-top: 5px solid var(--accent); border-radius: var(--radius-lg);
    padding: 18px 16px; box-shadow: var(--shadow-card);
  }
  .milestone.done    { border-top-color: var(--text-muted); opacity: 0.7; }
  .milestone.current { border-top-color: var(--accent-gold); background: rgba(255, 191, 71, 0.08); box-shadow: 0 0 20px rgba(255, 191, 71, 0.12), var(--shadow-card); }
  .milestone.future  { border-top-color: var(--accent-mint); }
  .milestone .phase  { font-family: var(--font-title); font-size: 0.64em; color: var(--accent-soft); letter-spacing: 0.06em; margin-bottom: 8px; font-weight: 700; }
  .milestone.current .phase { color: var(--accent-gold); }
  .milestone.future .phase  { color: var(--accent-mint); }
  .milestone h3 { margin-bottom: 6px; }
  .milestone p  { margin: 0; font-size: 0.76em; }

  /* ============================================================
     BIG NUMBER
     ============================================================ */

  .big-stat { font-family: var(--font-title); font-size: 4.2em; font-weight: 700; line-height: 0.92; color: var(--accent-soft); margin-bottom: 8px; }
  .big-sub  { color: var(--text-main); font-size: 0.88em; margin-bottom: 20px; }

  /* ============================================================
     QUOTE / CALLOUT
     ============================================================ */

  .quote-block {
    position: relative; padding: 32px 36px 28px 52px; border-radius: var(--radius-lg);
    background: rgba(10, 20, 38, 0.72); border: 1px solid var(--border-soft);
    border-left: 5px solid var(--accent-gold); box-shadow: var(--shadow-panel);
  }
  .quote-block::before {
    content: "\201C"; position: absolute; top: 16px; left: 16px;
    font-size: 3em; color: var(--accent-gold); opacity: 0.6;
    font-family: Georgia, "Times New Roman", serif; line-height: 1;
  }
  .quote-block p { font-size: 1.08em; line-height: 1.52; color: var(--text-main); font-style: italic; margin: 0; }
  .quote-attribution { margin-top: 16px; color: var(--text-muted); font-size: 0.74em; font-style: normal; }
  .quote-interpretation {
    margin-top: 20px; padding: 16px 20px; border-radius: var(--radius-md);
    background: rgba(9, 19, 38, 0.56); border-left: 3px solid var(--accent);
    color: var(--text-sub); font-size: 0.82em;
  }

  /* ============================================================
     COMPARE (two-column-compare)
     ============================================================ */

  .compare-panel { padding: 20px 22px; border-radius: var(--radius-lg); border: 1px solid var(--border-soft); min-height: 240px; }
  .compare-panel.before { background: rgba(255, 138, 125, 0.06); border-top: 5px solid var(--accent-warn); }
  .compare-panel.after  { background: rgba(53, 211, 153, 0.06); border-top: 5px solid var(--accent-mint); }
  .compare-label {
    display: inline-block; padding: 4px 14px; border-radius: 999px;
    font-size: 0.54em; font-weight: 700; letter-spacing: 0.1em; margin-bottom: 14px;
  }
  .compare-panel.before .compare-label { background: rgba(255, 138, 125, 0.2); color: var(--accent-warn); }
  .compare-panel.after .compare-label  { background: rgba(53, 211, 153, 0.2); color: var(--accent-mint); }
  .compare-panel h3 { margin-bottom: 8px; }
  .compare-panel ul  { margin-top: 0.1em; }

  /* ============================================================
     ARCHETYPE OVERRIDES
     ============================================================ */

  section.title-hero, section.section-divider {
    background:
      radial-gradient(circle at top right, rgba(67, 211, 255, 0.12) 0, rgba(67, 211, 255, 0) 34%),
      radial-gradient(circle at bottom left, rgba(255, 191, 71, 0.1) 0, rgba(255, 191, 71, 0) 26%),
      linear-gradient(135deg, #112347 0%, #09152a 42%, #050c18 100%);
  }

  section.title-hero { display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; }
  section.title-hero h1 { font-size: 1.72em; line-height: 1.14; margin-bottom: 18px; }
  section.title-hero h2 { padding-bottom: 0; margin-bottom: 0; color: var(--text-sub); font-size: 0.82em; max-width: 1080px; margin-left: auto; margin-right: auto; }
  section.title-hero h2::after { display: none; }
  section.title-hero .hero-note { margin-top: 24px; color: var(--text-muted); font-size: 0.68em; }
  section.title-hero::after { display: none; }

  section.agenda-overview h2 { margin-bottom: 20px; }
  section.agenda-overview .banner, section.title-content .banner { background: rgba(9, 19, 38, 0.44); }

  section.title-content .content-panel.flat { max-width: 980px; }
  section.two-column-content .content-panel.dual { min-height: 240px; }

  section.section-divider { justify-content: center; align-items: flex-start; padding: 86px 96px; text-align: left; }
  section.section-divider::after { display: none; }
  section.section-divider h2 { font-size: 2.4em; margin-bottom: 12px; }
  section.section-divider h2::after { width: clamp(160px, 28%, 220px); height: 5px; background: linear-gradient(90deg, var(--accent-gold), rgba(255, 191, 71, 0.14)); }
  section.section-divider .section-kicker {
    display: inline-flex; align-items: center; gap: 8px; margin-bottom: 16px;
    padding: 6px 14px; border-radius: 999px; background: rgba(255, 191, 71, 0.16);
    color: #ffe1a8; font-size: 0.54em; font-weight: 700; letter-spacing: 0.14em;
  }
  section.section-divider .subline { max-width: 880px; font-size: 0.94em; color: var(--text-main); }
  section.section-divider .section-note {
    margin-top: 22px; max-width: 820px; padding: 14px 18px;
    border-left: 4px solid var(--accent-gold); border-radius: var(--radius-md);
    background: rgba(9, 19, 38, 0.68); color: var(--text-sub); font-size: 0.72em;
  }

  section.big-number { justify-content: center; }
  section.quote-callout { justify-content: center; }

  section.closing-next-action .sources { margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.1); }
  section.closing-next-action .stack { gap: 12px; }
  section.closing-next-action .card  { padding: 14px 18px; }
  section.closing-next-action h3     { margin-bottom: 6px; }
  section.closing-next-action .micro { font-size: 0.52em; }

---

<!-- _class: title-hero -->
<!-- _paginate: false -->

# Put the decision-worthy message here
## Reuse the bundled visual direction while replacing all topic-specific copy

<p class="hero-note">Subtitle, audience cue, or source note</p>

---

## Lead with the outcome and make the deck scan fast

<div class="grid-3">
<div class="card">
<div class="pill">Outcome</div>
<h3>State one result</h3>
<p>Keep each card short and decision-oriented.</p>
</div>
<div class="card mint">
<div class="pill">Evidence</div>
<h3>Show what supports it</h3>
<p>Prefer numbers, contrasts, or proof over generic bullets.</p>
</div>
<div class="card gold">
<div class="pill">Action</div>
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
<div class="icon-box">01</div>
<div>
<h3>Context</h3>
<p>Set the context.</p>
</div>
</div>
<div class="agenda-item">
<div class="icon-box">02</div>
<div>
<h3>Main discussion</h3>
<p>Name the core topic.</p>
</div>
</div>
<div class="agenda-item">
<div class="icon-box">03</div>
<div>
<h3>Evidence and options</h3>
<p>Show proof and choices.</p>
</div>
</div>
<div class="agenda-item">
<div class="icon-box">04</div>
<div>
<h3>Recommendation</h3>
<p>Close with the ask.</p>
</div>
</div>
</div>

<div class="banner">Use 1 column for 3 items and 2 columns for 4-5.</div>

---

<!-- _class: title-content -->

## State the conclusion as the title, then support it below

<div class="content-panel flat">
<div class="panel-head">
<div class="icon-box">i</div>
<div>
<div class="pill">Main content</div>
<h3>Keep bullets supportive, not repetitive</h3>
</div>
</div>
<ul>
<li>Use up to <strong>three</strong> bullets or one compact diagram.</li>
<li>Each bullet should add a new supporting fact, not rephrase the title.</li>
<li>Leave enough whitespace that the eye knows where to start.</li>
</ul>
<div class="quiet-note">This archetype is the quiet baseline of the deck. Keep it visually calmer than hero or comparison slides.</div>
</div>

---

<!-- _class: assertion-evidence -->

## Make a claim as the title, then prove it visually

<div class="grid-2">
<div class="content-panel flat">
<div class="panel-head">
<div class="icon-box">&check;</div>
<div>
<div class="pill">Evidence</div>
<h3>Support the assertion with 2-3 points</h3>
</div>
</div>
<ul>
<li>The title states the conclusion &mdash; bullets prove it.</li>
<li>Use data, comparisons, or concrete facts &mdash; not opinions.</li>
<li>If you need more than 3 bullets, split into two slides.</li>
</ul>
</div>
<div class="card" style="display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;">
<div class="big-stat">87%</div>
<p style="font-size:0.82em;color:var(--text-sub);">A single number or diagram can be the strongest evidence.</p>
</div>
</div>

---

<!-- _class: two-column-compare -->

## Compare two options to show why one wins

<div class="grid-2">
<div class="compare-panel before">
<div class="compare-label">BEFORE / OPTION A</div>
<h3>Current approach</h3>
<ul>
<li>Manual process, 3 hours per cycle</li>
<li>Error rate: 12%</li>
<li>No audit trail</li>
</ul>
</div>
<div class="compare-panel after">
<div class="compare-label">AFTER / OPTION B</div>
<h3>Proposed approach</h3>
<ul>
<li>Automated pipeline, 15 min per cycle</li>
<li>Error rate: under 1%</li>
<li>Full audit log included</li>
</ul>
</div>
</div>

<div class="banner">Use this archetype for explicit A vs B comparisons: before/after, option A vs B, current vs future.</div>

---

<!-- _class: two-column-content -->

## Place two related ideas side by side when both deserve equal weight

<div class="grid-2">
<div class="content-panel dual">
<div class="panel-head">
<div class="icon-box">A</div>
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
<div class="icon-box">B</div>
<div>
<div class="pill">Right column</div>
<h3>Second content block</h3>
</div>
</div>
<ul>
<li>Use parallel structure when possible.</li>
<li>Keep column heights visually balanced.</li>
<li>Reserve <code>two-column-compare</code> for A vs B stories.</li>
</ul>
</div>
</div>

---

<!-- _class: process-flow -->

## Show a clear sequence of steps with visual flow

<div class="flow cols-4">
<div class="step">
<div class="step-number">1</div>
<h3>Collect</h3>
<p>Gather requirements from stakeholders.</p>
</div>
<div class="step">
<div class="step-number">2</div>
<h3>Analyze</h3>
<p>Identify patterns and priorities.</p>
</div>
<div class="step">
<div class="step-number">3</div>
<h3>Build</h3>
<p>Create the solution in iterations.</p>
</div>
<div class="step">
<div class="step-number">4</div>
<h3>Launch</h3>
<p>Deploy, measure, and iterate.</p>
</div>
</div>

<div class="banner">Use 3-5 steps. Keep labels short. Arrow connectors appear automatically between steps.</div>

---

<!-- _class: timeline-roadmap -->

## Show milestones along a timeline to orient the audience

<div class="timeline cols-4">
<div class="milestone done">
<div class="phase">Q1 2026</div>
<h3>Foundation</h3>
<p>Architecture design and team onboarding complete.</p>
</div>
<div class="milestone current">
<div class="phase">Q2 2026 &bull; NOW</div>
<h3>Core build</h3>
<p>MVP development and internal testing in progress.</p>
</div>
<div class="milestone future">
<div class="phase">Q3 2026</div>
<h3>Pilot</h3>
<p>Limited rollout with early adopters.</p>
</div>
<div class="milestone future">
<div class="phase">Q4 2026</div>
<h3>Scale</h3>
<p>General availability and optimization.</p>
</div>
</div>

<div class="banner">Use 3-5 milestones. Highlight the current phase. Dates or phase names should be visually prominent.</div>

---

<!-- _class: big-number -->

## A single metric can be the most powerful message

<div class="grid-2">
<div style="display:flex;flex-direction:column;justify-content:center;">
<div class="big-stat">3.2x</div>
<div class="big-sub">Return on investment in the first year</div>
<p style="font-size:0.76em;">When a number is the story, make it the largest element on the slide. Add one label and one implication.</p>
</div>
<div class="stack">
<div class="card mint">
<h3>Context</h3>
<p>Industry average ROI is 1.4x over the same period.</p>
</div>
<div class="card gold">
<h3>Implication</h3>
<p>Payback is achieved within 4 months of launch.</p>
</div>
</div>
</div>

---

<!-- _class: quote-callout -->

## Let a powerful voice reinforce the message

<div class="quote-block">
<p>The best way to predict the future is to invent it.</p>
<div class="quote-attribution">&mdash; Alan Kay, Computer Scientist</div>
</div>

<div class="quote-interpretation">
<strong>Why this matters:</strong> Use quotes to anchor a principle, validate a direction, or add a human voice to data-heavy decks. Keep the interpretation brief.
</div>

---

<!-- _class: section-divider -->

<div class="section-kicker">SECTION</div>
<h2>Use strong divider moments</h2>

<p class="subline">Medium and long decks should visibly change rhythm between sections.</p>
<p class="section-note">Use this layout for chapter changes, not for regular content pages.</p>

---

<!-- _class: closing-next-action -->

## End with the action, owner, or decision request

<div class="grid-2">
<div class="stack">
<div class="card"><h3>Decision</h3><p>Name the recommendation clearly.</p></div>
<div class="card"><h3>Owner</h3><p>Show who acts next.</p></div>
<div class="card gold"><h3>Timing</h3><p>State the next milestone or deadline.</p></div>
</div>
<div class="stack">
<div class="card mint">
<h3>Takeaway</h3>
<p>Summarize the one thing the audience should remember.</p>
</div>
<div class="micro sources">
Sources or footnotes go here when needed.
</div>
</div>
</div>
