# Research Quality Review: the scored checklist (RQK-1)

Added 2026-10-18 at Grant's request: the review is now quantitative first, recommendations second.

**2026-10-19 (RQK-2):** the brief checklist is retired; a brief is rated on the ten RQC-3 dimensions and their dashboard instead (see `research-quality-brief-dashboard.md`). Reviews scored under RQK-1 still show it. The catalogue file is now `RQK-2.json`.

## What it does

Each document in a review is scored against the checklist for its confirmed role:

| Checklist | Roles | Elements | Basis |
|---|---|---|---|
| Research brief (retired in RQK-2) | brief | 15 in 4 sections | Founder's brief rubric (2026-10-18); ISO 20252:2019 |
| Research proposal | proposal | 22 in 5 sections | Founder's proposal rubric (2026-10-18); ISO 20252:2019 |
| Questionnaire | questionnaire | 14 in 4 sections | Krosnick and Presser (2010), Question and questionnaire design |
| Methodology or report | methodology, report, fieldwork | 17 in 3 sections | AAPOR Code (2021) disclosure standards; ISO 20252:2019 |

A discussion guide has no checklist yet; the screen says so rather than scoring it against the wrong list. The catalogue is `src/research-quality/checklists/RQK-2.json`: each element has what counts as present, what counts as partial, whether it is essential, and the recommendation to give when it is missing or partial.

## Who decides what

1. **Extraction (existing step).** The model lists the facts each document states, each with an exact quote that code locates in the document text.
2. **Checklist step (new, one per document and checklist).** The model marks every element present, partial or absent and cites the facts that show it.
3. **Code accepts or refuses each status** (`src/lib/researchQualityChecklist.ts`):
   - present or partial must cite a fact from that document's own text (a brief fact may be cited alongside, only for elements compared with the brief);
   - absent must cite nothing, and is not accepted for a document that was not read in full;
   - a brief's "at least three objectives" element is capped at partial unless three distinct cited facts are labelled objectives;
   - anything refused is **not assessed**, with the reason shown. Unknown is never scored as absent.
4. **Code scores.** Present 2, partial 1, absent 0. Section and overall percentages count assessed elements only; the overall figure is computed from all assessed elements, not an average of sections. Strong is 80% or more, Workable 60% or more (the objective scorer's bands). With fewer than half the elements assessed, no overall figure is given.
5. **Recommendations.** For every partial or absent element, the checklist's recommendation, essential elements first; then the assessment's improvements by timing, as before.

Percentages are computed when the review is shown or exported, from the stored statuses, so a change to the scoring rule needs no data migration. The checklist release is recorded in each review's manifest.

## Where it shows

- **Overview:** a card per document with the overall percentage and band, a section table and the element list with quotes and reasons.
- **Improvements:** "Missing or partial elements" first.
- **Word export:** "Scored checklist" section, and the gaps at the start of the improvement plan.

## Setup

Apply **migration 0106** (`supabase/migrations/0106_research_quality_checklist.sql`), which allows the new `checklist` task stage. Without it, reviews run as before and the screen says which migration adds the checklist. Reviews made before the checklist show a note to start a new review version.

## Tests

- `src/lib/__tests__/researchQualityChecklist.test.ts` (13): catalogue integrity, every acceptance rule, hand-computed section and overall percentages, band edges, the half-assessed threshold, gap ordering.
- `src/lib/__tests__/researchQuality.db.test.ts` (+5, real database, actual actions): brief and proposal scored with an independent recount of every percentage and quotes behind every presence; presence claimed without quotes is not scored; a failed checklist step shows no score and recovers on retry; behaviour without migration 0106; a role with no checklist.
- `e2e/ui/research-quality.check.mjs`: the grid in the browser, percentages recounted from the statuses on screen, and the gap list.

Limits: model judgement of each element is not yet measured against human raters; the checklist step adds one model call per document.
