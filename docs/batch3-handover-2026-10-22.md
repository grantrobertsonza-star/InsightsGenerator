# Handover: M-B2-01, M-B2-02 and the knowledge base (main copy), 22 October 2026

Status: **implemented, ready for independent review.** Main copy only; 3001 out of scope. Follows
`docs/independent-batch2-review-main-2026-10-22.md` (frozen `cb57da1`), whose closures and
acceptances stand. Comments and documentation only: **no code, formula or behaviour change**, no
migration. Nothing pushed or deployed; no development or live database touched.

| Commit | What |
|---|---|
| `41cdc49` | Knowledge base and manual brought up to date (made before the batch2 review, outside its verdict) |
| `8ff226d` | M-B2-01 and M-B2-02 |
| this commit | Handover and status line |

## M-B2-01: the scale heuristic as it is

`src/lib/meanRow.ts`: the `isTenPointScale` comment no longer promises that a count variable with 10
values is qualified. It now says the rule is a broad heuristic by count of distinct values, that the
engine's `_is_ordered_scale` accepts any 10 or more distinct unlabelled whole-number codes (not
checked to be consecutive, nothing tells a rating from a count), and which codes do get the
qualified label (declared nominal, labelled non-scale, non-integer). The engine docstring of
`_is_ordered_scale` states the same breadth. `claude/starter-tables.md` and
`claude/crosstab-ask-statistics.md` state the heuristic, its limit and the preserved controls
(nominal, labelled non-scale, fractional, fewer than 10 distinct values, ordinary ratings). The
knowledge article already said a count with 10 or more values gets a mean. No narrower policy was
introduced. Also corrected: `claude/research-quality-presentation.md` pointed to the objective
scoring brief; it now names `researchQualityDashboard.ts`, `researchQualityRules.ts` and
`researchQualityChecklist.ts`.

## M-B2-02: sidebar brief

New `claude/sidebar-navigation.md`: the authoritative implementation (`RunShell.tsx`, `RunNav`), the
toggle and its accessibility, the open-section exception, the key `run-nav-folded:v1` and its
browser-wide, group-name scope (a renamed group starts open), the server snapshot and first render,
cross-tab `storage` events and the same-tab event, blocked read or write and malformed values (open in
full), the icon rail that does not fold, tests and limits.

## Knowledge base and manual (`41cdc49`)

Import, Objectives and Cross tabs articles updated for the changes since 8 October; new Research
quality article; manual limits, verification and raw-data pages now say survey design and the
multiple-comparison correction apply in cross tabs and NPS (named PSU and strata; false discovery
rate by default) and not in the banner plan or aggregated-table scan. Checked against code and
briefs. Rendered: the knowledge index, the four articles and the three manual pages load (200) with
no page errors on the production build. Findings, Insights, Reports and Decisions articles were not
re-checked.

## Checks run

`npx tsc --noEmit -p .` pass; `engineNumberedScaleMean` and `starterMeanScaleEngine` 13 passed after
the docstring change (`python3 -c "import ast; ..."` parses). The batch2 full suites are unaffected by
comment and document changes and were not repeated.
