# Gold deck asset sources

All SVG files in this directory are original, local demonstration assets created for the marp-slide v1 templates. They do not fetch external fonts, images, scripts, or styles. Reproducible chart data/Vega-Lite specs and Mermaid diagram sources are stored under `sources/`; the checked-in SVG remains the runtime-free slide asset.

The values shown in charts and diagrams are fictional fixture data. They demonstrate provenance, units, time periods, uncertainty labels, and accessible descriptions; they are not real operational claims.

| Asset family | Purpose | License / source |
|---|---|---|
| `executive-*` | Executive decision illustration, data charts, process diagrams | Original bundled demo vector; no external license dependency |
| `analytical-*` | Read-ahead analysis flow, cohort/segment charts, experiment design | Original bundled demo vector; no external license dependency |
| `technical-*` | Training illustration, log screenshot, latency chart, decision tree | Original bundled demo vector; no external license dependency |

## Rebuild map

| Output SVG | Authoritative source |
|---|---|
| `executive-volume-chart.svg` | `sources/executive-volume-chart.csv` + `sources/executive-volume-chart.vl.json` |
| `analytical-cohort-chart.svg` | `sources/analytical-cohort-chart.csv` + `sources/analytical-cohort-chart.vl.json` |
| `analytical-segment-map.svg` | `sources/analytical-segment-map.csv` + `sources/analytical-segment-map.vl.json` |
| `technical-latency-chart.svg` | `sources/technical-latency-chart.csv` + `sources/technical-latency-chart.vl.json` |
| `executive-decision-gate.svg` | `sources/executive-decision-gate.mmd` |
| `executive-roadmap.svg` | `sources/executive-roadmap.mmd` |
| `executive-search-flow.svg` | `sources/executive-search-flow.mmd` |
| `analytical-method.svg` | `sources/analytical-method.mmd` |
| `analytical-experiment.svg` | `sources/analytical-experiment.mmd` |
| `technical-first-15-flow.svg` | `sources/technical-first-15-flow.mmd` |
| `technical-decision-tree.svg` | `sources/technical-decision-tree.mmd` |

Use `marp_render_chart` or `marp_render_diagram` to rebuild the matching SVG. Keep both source and static output; the slide never runs Vega or Mermaid in the browser.
