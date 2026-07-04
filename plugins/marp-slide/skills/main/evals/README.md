# marp-slide v0.8 evaluation

`evals.json` contains five type-specific prompts for comparing v0.8 with the previous plugin revision.

## Procedure

1. Generate one deck per prompt with the previous plugin revision and with v0.8.
2. Export every deck to PDF and per-page PNG.
3. Randomize the pair labels so the evaluator cannot see which revision produced each deck.
4. Score each pair on:
   - audience and goal fit
   - evidence quality
   - visual hierarchy and semantic fit
   - cohesion and polish
5. Record the preferred deck and concrete reasons.

## Acceptance

- v0.8 must be preferred in at least four of five prompts.
- All v0.8 decks must export successfully.
- No v0.8 deck may omit must-include content or present an unsupported estimate as fact.
- Training must not receive a forced executive CTA.
- Report and research must preserve method and limitations.
- The exact-count executive update must contain six slides.

Subjective design quality should be judged from the rendered PNG/PDF, not from Markdown or lint output alone.
