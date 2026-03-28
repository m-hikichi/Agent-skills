# Layout Patterns

## Density Rules

- Put the conclusion in the heading
- Keep one message per slide
- Aim for at most five bullet items
- Keep tables short and code blocks concise
- Prefer whitespace over cramped content

## Useful Frontmatter

```markdown
---
marp: true
theme: default
paginate: true
html: true
style: |
  @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined');
  section {
    font-family: 'Noto Sans JP', sans-serif;
  }
  .icon {
    font-family: 'Material Symbols Outlined';
    font-size: 1.2em;
    vertical-align: middle;
    margin-right: 0.3em;
    font-variation-settings: 'FILL' 0, 'wght' 300;
  }
---
```

## Two Columns

```markdown
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2em;">
<div>

### Current
- Point 1
- Point 2

</div>
<div>

### Future
- Benefit 1
- Benefit 2

</div>
</div>
```

## Card Layout

```markdown
<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1em;">
<div style="background: #f0f7ff; border-left: 4px solid #3b82f6; border-radius: 8px; padding: 1em;">

**Result A**
Short note

</div>
</div>
```

## Icon Bullets

```markdown
- <span class="icon">check_circle</span> Completed item
- <span class="icon">warning</span> Item needing attention
- <span class="icon">arrow_forward</span> Next action
```

## Visual Review Reminder

- Markdown can look fine while the rendered PDF still overflows
- If a layout looks risky, split it before the reviewer sees the page images