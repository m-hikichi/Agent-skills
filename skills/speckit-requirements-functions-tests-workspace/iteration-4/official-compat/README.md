# Official Spec Kit v1.0.0 compatibility smoke verification

Verified on 2026-09-23, Windows / PowerShell. Scope: **official CLI scaffolding and template-shape compatibility**, not agent command end-to-end or semantic correctness.

## Provenance

- Official release: https://github.com/github/spec-kit/releases/tag/v1.0.0
- Resolved commit: `bca679051abb80d6cf0cd909f2539a28a10eb7eb`
- `specify --version`: `specify 1.0.0`
- Bundled `spec-template.md` SHA-256: `3945437fc35cd30a5b2bf7beea680337c3516826d3efa5a6b92c4a7eca1ba28e`
- Official package metadata: https://github.com/github/spec-kit/blob/v1.0.0/pyproject.toml

The package was fetched using `uv tool run --from git+https://github.com/github/spec-kit.git@v1.0.0`. Cache and ephemeral tool directories were set inside this workspace; no global tool installation or configuration was performed. The normal sandbox could not reach GitHub/PyPI (connection failure / Windows socket error 10013); an approved elevated fetch succeeded. Subsequent CLI calls used the pinned commit offline.

## Executed checks

1. Official `specify init ... --integration codex --integration-options=--skills --ignore-agent-tools --non-interactive --script ps` succeeded in the isolated `project` directory.
2. Official `.specify/scripts/powershell/create-new-feature.ps1 -Json -ShortName notification-preferences -Number 1 ...` succeeded and produced the official spec template.
3. The template was filled by hand with a controlled two-story notification fixture. This authoring step was **not** performed by `$speckit-specify`, `/speckit.specify`, or a separate agent application.
4. The skill's `generate_documents.py ... --profile draft` succeeded and generated five artifacts in `output`.
5. `check_documents.py ... --profile draft --output-dir output` returned exit 0: all six axes had zero errors; status `draft-ready`.
6. `check_documents.py ... --profile publish --output-dir output` returned exit 1 as expected: unresolved review, unconfirmed function boundaries, and incomplete test data prevented publication.

Observed counts: 11 requirements, 2 functions, 10 tests, 8 open questions. Draft had 13 warnings and publish had 13 blocking errors at the time of this check. These are safety-gate observations, not a claim that the authored fixture is ready for real test execution.

## Reproduction

From the workspace root, use a new, non-existing directory:

```powershell
pwsh -NoProfile -File skills/speckit-requirements-functions-tests-workspace/iteration-4/official-compat/reproduce.ps1 -RunDirectory skills/speckit-requirements-functions-tests-workspace/iteration-4/official-compat/rerun
```

Network access is needed if the exact pinned package/dependencies are not cached. The script refuses an existing target and never deletes a prior run. The official generated scaffold is retained in `project`; the authored spec and resulting artifacts are also retained for inspection.

## Not verified

- Real agent-command chain (`specify`/`clarify`/`plan`/`analyze`) running within an installed coding-agent application.
- Official-agent-generated plan-enriched inputs, community presets, extensions, every 1.0.x release, or arbitrary business-domain semantics.
- Test execution or production acceptance.

Accordingly this report does not change the skill's `tested_versions` metadata or assert full v1.0.x end-to-end support.
