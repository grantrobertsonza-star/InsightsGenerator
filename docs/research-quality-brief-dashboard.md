# Research Quality Review: the brief dashboard (RQC-3)

Added 2026-10-19 at Grant's request: a bird's-eye view first (Overview tab), the detail on a separate tab (Details).

## The ten brief dimensions

Criteria release `src/research-quality/criteria/RQC-3.json`, group `brief`. Each is rated by the model Strong 5, Workable 3, Weak 1 or Absent 0, citing facts extracted with located quotes, and validated by code (`researchQualityRules.ts`), as every criterion is.

| # | Dimension (id) | Weight | What is rated |
|---|---|---|---|
| 1 | Background (RQ-BRIEF-BACKGROUND v2) | 1 | Situation, trigger, what is already known, product or market |
| 2 | Business problem (RQ-BRIEF-PROBLEM v2) | 2 | A problem with its consequence, not only a topic |
| 3 | Decisions to inform (RQ-BRIEF-DECISION v2) | 2 | The decisions, who makes them, what success looks like |
| 4 | Research objectives (RQ-BRIEF-OBJECTIVES v2) | 2 | Specific, measurable, prioritised, broad to specific |
| 5 | Audience and scope (RQ-BRIEF-AUDIENCE) | 1 | Definition of who qualifies, geography, subgroups, incidence, languages, exclusions |
| 6 | Method guidance (RQ-BRIEF-METHOD) | 1 | Initial thinking and real constraints, room for the supplier; over-prescription counts against |
| 7 | Deliverables (RQ-BRIEF-DELIVERABLES) | 1 | Outputs, format, level of analysis, key indicators, data files |
| 8 | Timing (RQ-BRIEF-TIMING) | 1 | Deadline, milestones, realistic fieldwork and reporting allowance |
| 9 | Budget (RQ-BRIEF-BUDGET v2) | 1 | Amount or range and its flexibility |
| 10 | Practicalities (RQ-BRIEF-PRACTICAL) | 1 | Contacts, approvers, roles, confidentiality and ethics, submission details, selection criteria |

Retired in RQC-3 and kept only so that earlier reviews still show their questions: RQ-BRIEF-METHOD-PARAMS (split into Audience and Method) and RQ-BRIEF-DEADLINE (now Timing). `selectCriteria` never offers a retired criterion.

Sources:
- EY Sweeney, *Instructions for preparing a market research brief* (supplied PDF).
- John, C. F. (2007). The research brief. In M. van Hamersveld & C. de Bont (Eds.), *Market research handbook* (5th ed., pp. 501-523). Wiley. https://doi.org/10.1002/9781119208044.oth1
- B2B International, *The market research brief*: https://www.b2binternational.com/publications/market-research-brief/
- IntoTheMinds, *Market research specifications*: https://www.intotheminds.com/blog/en/market-research-specifications/
- Ventures, *Crafting an accurate brief for effective market research*: https://www.ventures-me.com/venture_insights/crafting-an-accurate-brief-for-effective-market-research/
- The Market Researchers, *Example market research brief*: https://www.themarketresearchers.co.uk/example-market-research-brief/
- P. Latimer, *7 questions to ask before writing a market research brief* (LinkedIn): suggested by Grant, could not be read automatically, not used.

## The overall figure (code, `src/lib/researchQualityDashboard.ts`)

- Dimension score: its rating; with several live observations for one criterion, the lowest.
- Overall: sum(weight x score) / sum(weight x 5) over rated dimensions, as a whole percentage. Problem, decisions and objectives count double (every source treats them as the core of a brief; IntoTheMinds names a missing decision and a topic in place of a problem as the most common failures).
- Bands: Strong 80% or more, Workable 60% or more, Weak below (`dashboardBands` in the release).
- A dimension not rated (still running, failed, or dismissed by the researcher) is left out of the base, never counted as zero. Absent (0) is a rating and is counted.
- With less than half the total weight rated, no overall figure is given.

This replaces RQC-2's "scores are never combined" for the brief only, at Grant's request; the per-dimension scores stay beside the overall on screen and in the export.

## The brief checklist (RQK-2)

The element checklist for a brief (RQK-1) is retired in RQK-2: the ten dimensions replace it. Reviews scored under RQK-1 keep showing their brief checklist. Proposal, questionnaire and methodology checklists are unchanged.

## Screens

- **Overview:** the dashboard card (ring with the overall %, one bar per dimension with its score and rating, x2 on the doubled ones, the model's reason on hover) and a bar per other document's checklist %.
- **Details:** the checklist grid, the scorecard, the criteria that did not apply and every criterion card with its evidence and actions.
- **Word export:** a Dashboard section with the same figures.
- A review made under an earlier criteria release shows a note instead of the dashboard: start a new review version.

## Tests

- `src/lib/__tests__/researchQualityDashboard.test.ts`: weights really applied (hand-computed 72% against an unweighted 67%), lowest of several ratings, dismissed and unrated left out, the half-weight threshold, failed and running states, bands at their edges, which reviews get a dashboard.
- `src/lib/__tests__/researchQuality.db.test.ts` (real database, actual actions): a brief review recounted independently from the stored ratings, the export lines, a dismissal moving the figure, and an RQC-2 review showing the note.
- `e2e/ui/research-quality.check.mjs`: the ten bars, the overall percentage recomputed from the scores on screen, evidence only on Details.

Limits: the ratings are model judgements validated for evidence, not checked against human raters; the weights are a stated choice, not an empirical result.
