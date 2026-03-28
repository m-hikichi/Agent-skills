# Slide Archetypes And Layout Patterns

Every slide must choose one approved archetype in `.slide-work/slide-plan.yaml`.
If more than 40% of slides use the same archetype, redesign the deck unless repetition is clearly essential.

## Shared Rules

- Put the takeaway in the title
- Keep one message per slide
- Keep bullet-only slides under 30% of the deck
- Use local class directives when an archetype needs custom styling
- Prefer whitespace over cramped content
- Avoid dense bullet lists, paragraph-heavy slides, and table-heavy slides

## Marp Implementation Defaults

- Use a custom visual foundation, not untouched default Marp output
- Set global directives for `theme`, `paginate`, `header`, and `footer`
- Use split backgrounds only on `section-divider` or comparison slides
- Use background images only when they reinforce the message
- Use icons only when they improve scanability

## title-hero

- Use for the first slide or a major opening beat
- Keep to title, subtitle, and audience/context cue
- Avoid support bullets
- Suggested class: `title-hero`

## section-divider

- Use between sections in medium or long decks
- Keep to one headline and one short subline
- Use split background here if any slide uses it
- Suggested class: `section-divider`

## assertion-evidence

- Use when one claim needs two or three proof points
- Keep to one assertion title and up to three support bullets or one compact visual
- Avoid repeating the title in the bullets
- Suggested class: `assertion-evidence`

## two-column-compare

- Use for before/after, option A vs B, or current vs future
- Keep each side to at most three comparison rows
- Avoid adding a third comparison column
- Suggested class: `two-column-compare`

## process-flow

- Use for sequential steps or operating model explanations
- Keep to three to five steps
- Add short labels, not paragraphs
- Suggested class: `process-flow`

## timeline-roadmap

- Use for milestones, rollout phases, or implementation timing
- Keep to three to five milestones
- Emphasize dates or phase names visually
- Suggested class: `timeline-roadmap`

## big-number

- Use when one metric or headline number is the message
- Pair the number with one label and one implication
- Avoid surrounding the number with dense commentary
- Suggested class: `big-number`

## architecture-diagram

- Use for system structure or component relationships
- Keep to three to six nodes and one dominant flow
- Add only the labels needed to explain the diagram
- Suggested class: `architecture-diagram`

## quote-callout

- Use for voice-of-customer, executive quote, or principle statement
- Pair the quote with a short interpretation or implication
- Avoid long quotation blocks
- Suggested class: `quote-callout`

## closing-next-action

- Use for the final slide
- State the decision, action, owner, or timing clearly
- Do not end with a generic thank-you slide unless the user explicitly wants it
- Suggested class: `closing-next-action`

## Visual Review Reminder

- Markdown can look fine while the rendered PDF still overflows
- If a layout looks risky, split it before the reviewer sees the page images
