# Design Reference Playbook

## First Principle

- Build `.slide-work/design-system.yaml` before drafting slides
- Define typography, spacing, color emphasis, and archetype usage explicitly
- Do not ship untouched default Marp styling as final output

## Reuse An Existing Marp Deck

1. Read the reference deck frontmatter
2. Extract theme, style, color, spacing, and heading patterns
3. Reuse the direction, not a pixel-perfect copy

## Reuse A PPTX Style

1. Observe colors, typography, spacing, and decoration
2. Recreate only the parts that fit Marp cleanly
3. Prefer readability over visual mimicry

## No Design Reference

- Start from the presentation type and audience, then fill `design-system.yaml`
- Use `gaia` when you need a stronger stage-presentation feel
- Use `uncover` when you need a cleaner editorial feel
- Add custom CSS or theme tokens before draft completion
