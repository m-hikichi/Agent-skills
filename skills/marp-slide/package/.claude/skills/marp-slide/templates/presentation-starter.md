---
marp: true
theme: gaia
paginate: true
html: true
header: ""
footer: ""
style: |
  :root {
    --deck-ink: #16324f;
    --deck-muted: #5a7184;
    --deck-accent: #1570ef;
    --deck-accent-soft: #e7f1ff;
    --deck-surface: #f6f9fc;
    --deck-divider: #d9e3ec;
  }

  section {
    font-family: "Aptos", "Segoe UI", "Hiragino Sans", sans-serif;
    color: var(--deck-ink);
    background: linear-gradient(180deg, #fbfdff 0%, #f2f7fb 100%);
    padding: 54px 72px 64px;
  }

  h1,
  h2,
  h3 {
    letter-spacing: -0.03em;
    line-height: 1.1;
  }

  p,
  li {
    color: #27445d;
    line-height: 1.45;
  }

  strong {
    color: var(--deck-accent);
  }

  header,
  footer {
    color: var(--deck-muted);
    font-size: 0.38em;
  }

  section.title-hero,
  section.section-divider {
    background:
      radial-gradient(circle at top right, rgba(21, 112, 239, 0.16), transparent 34%),
      linear-gradient(160deg, #16324f 0%, #1f4d78 58%, #1570ef 100%);
    color: #ffffff;
  }

  section.title-hero h1,
  section.section-divider h2,
  section.title-hero p,
  section.section-divider p,
  section.title-hero strong,
  section.section-divider strong {
    color: #ffffff;
  }

  section.big-number strong {
    display: block;
    font-size: 2.2em;
    line-height: 1;
    margin-bottom: 0.2em;
  }

  .eyebrow {
    display: inline-block;
    padding: 0.2em 0.6em;
    border-radius: 999px;
    background: var(--deck-accent-soft);
    color: var(--deck-accent);
    font-size: 0.42em;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
---

<!-- _class: title-hero -->
<div class="eyebrow">Executive summary</div>

# Put the decision-worthy message here

Short subtitle for the audience, context, or timing

---

<!-- _class: assertion-evidence -->
## State the takeaway in the title, not the topic

- Up to **three** supporting bullets
- Surface the number, comparison, or evidence that matters most
- Split the slide if the eye does not know where to look

---

<!-- _class: closing-next-action -->
## End with the action, decision, or next step

- Decision needed or recommendation
- Owner or audience
- Timing or next milestone
