# Batch R5 segment handover (30 October 2026)

Status: **implemented, ready for independent review.** Branch `r5segment`, base `b3e230f`. Tier A (engine, loaders,
calculations) with a tier B screen. No migration.

Grant (owner, 30 October 2026), on the Brand tracking dashboard's chips row: "we need a filter up here, so the user can
filter on a segment (age, gender, etc.)". The "Segment: All eligible" chip was static text; it is now a working global
filter.

## What changed

- **One owner, `src/lib/trackerSegment.ts`.** A segment is one to four profile questions, each with one or more answers
  by raw code: OR within a question, AND across questions. `parseSegment` checks the shape at the server boundary;
  `segmentQuestionsOf` lists the file's profile questions; `resolveSegment` / `applySegment` check a segment against
  the open file; `segmentFilters` / `withSegment` turn it into engine filters; `computeInSegment` is the only way the
  tracker loaders compute a table (it calls `computeCrosstab` with the segment's filters and words an empty segment);
  `segmentReading` gives the page's segment and base; `segmentAgainstWave` decides whether a compared wave can take the
  segment in the same meaning.
- **Engine (`api/parse-stats-file.py`).** New filter op `codes`: respondents whose answer's raw code (the
  `CrosstabRow.rawCode` text form, `_code_text(_raw_key(v))`) is any of the given codes; never by label; blank is
  outside. The existing `in` op takes labels and `between` ANDs ranges, so neither could express "code 1 or code 3" by
  code. Also a defect the segment exposed: under any filter a banner column where everyone is selected could read
  1.0000000000000002 (the selected sum runs over filtered-out zero weights and numpy groups the additions differently),
  and `sqrt(p * (1 - p) / n)` failed the whole table with "math domain error". Every subset share in `prop_row` now
  goes through `_subset_share` (held within 0 to 1; NaN for an empty base). Reproduced on BMW wave 1, Advertising &
  WOM, brand b04 under the segment, with the existing `in` / `between` filters too, so it was pre-existing for filtered
  tables with a banner.
- **Profile recognition owner reused.** `starterTables.DEMOGRAPHICS` is the one list; it is exported through
  `demographicKindOf` and gains income and household life stage (after employment, before customer groupings), so
  starter tables also split by them. No parallel list.
- **Every page loader takes the segment** (`loadBrandOverview` via `brandOverviewFigures`, `loadBrandMoments`,
  `loadBrandAssociations`, `loadBrandAdvertising`, `loadBrandAudience`, `loadCategoryOverview`) and each server action
  in `trackerDashboardActions.ts` takes `segmentRaw` (validated by `parseSegment`). Each page result carries
  `segment: SegmentReading | null`; `BrandOverview` also carries `segmentQuestions` and `previous` can be `"withheld"`.
- **Screen.** New `src/app/runs/[id]/SegmentPicker.tsx`: `SegmentChip` (question list, answers as checkboxes, Apply,
  Clear, "All eligible" when none), `useStoredSegment` (per browser), `CardSegmentBase` (each card's base line).
  `TrackerDashboardPanel.tsx` edits are grouped and small: the hook and last-known questions state, the segment passed
  to the six actions and their dependency lists, the chip in place of the static one (and while loading or failed),
  `Card` renders the base line, the basis line says the segment is applied in both waves, the failed state offers
  "Clear the segment", and the context provider around the page.
- **CSM dashboard:** not included. Its tiles come from `runDistributionAction`, `runNpsAction` and
  `runDriverAnalysisFor`, which take no filter; the segment owner does not fit them without changing three other
  tools. Its "Segment: All segments" chip is unchanged, and `loadBrandOverview(..., "csm", segment)` refuses a segment
  with the reason.

## The segment contract

In `claude/d2-design-2026-10-29.md`, "R5 Segment" (definition, profile questions, computation, bases and states,
across waves, persistence, screens, downstream, reference values), and the registry rows "A tracker dashboard's
segment", "Which variables are demographic or profile questions", "Restricting a table by raw answer code" and "A
share of a subset over its base". `claude/starter-tables.md` updated for income and life stage.

## Impact checklist

1. **Rule.** New rule with a registry row and a contract (above). Owners reused: `computeCrosstab` (every figure), the
   engine's filter path (design kept, filtered cases weight 0), `demographicKindOf` (recognition),
   `trackerFigures.codeNamesDiffer` (cross-wave code identity), `selectedShareOf` / `answersOf` (readings, unchanged).
   No loader builds its own filter: each calls `computeInSegment`.
2. **Inputs.** No segment: all eligible, as before (every existing test unchanged). A malformed segment: refused at the
   action ("The segment was not understood. Choose it again."). A question or code the file lacks, or a question that
   is not a profile question: the page fails with the reason, never shown unsegmented. A blank answer to a segment
   question: outside. A small segment: the engine's suppression on each figure (n/a "Suppressed for a small base", never
   0). Nobody in the segment: "No respondent in this file is in the segment <text> (n=0) ... Change or clear the
   segment." A compared wave the segment cannot apply to in the same meaning: withheld with the reason, no change and
   no trend point for it. Stored segment unreadable (storage blocked): all eligible.
3. **Persistence.** Decided per browser, not the programme's saved choices: localStorage key
   `tracker-segment:<runId>:<kind>`. Reason: a segment is a way of viewing figures (like the brands compared, which are
   not saved either), and saving it to the programme would change what every colleague sees on opening the dashboard;
   it also avoids compare-and-swap conflicts on quick switching. Nothing is written to the database. Every read and
   write of storage is in try/catch.
4. **Freshness.** Nothing derived is stored by the dashboard, so nothing goes stale. Downstream consumers that record
   provenance from the dashboard (findings, AI insights, slides on another branch) must record `segment` (see merge
   notes); none exists on this branch.
5. **Screens.** A segment change reloads every page through the panel's existing request counters: an answer for an
   earlier segment arriving after a later one's is ignored (mounted test). The chip stays usable while calculating
   and after a refusal. The base line names the segment on every card of the page shown. Nothing is "saved" on screen.
6. **Proof.** Below.

## Proof

- `src/lib/__tests__/trackerSegment.db.test.ts` (8 tests; real disposable PostgreSQL, the actual Python engine,
  in-memory storage stand-in, model stubbed and never called). Expected values from
  `src/lib/__tests__/helpers/segment_reference.py` (pandas, written from the pack's specification and the contract):
  1. BMW wave 1, Woman (gender 2) AND 25-34 or 35-49 (age_band 2, 3), 228 respondents, weighted: on all six pages the
     segment's n, weighted total and Kish effective base (engine one decimal, 0.051 tolerance) and filters; page 01
     funnel shares and bases for every brand at four stages, BMW's aware base and effective base and two association
     scores, every moment recall value shown, all twelve media shares, all decision style shares, to 1e-6; no table
     saved; the unsegmented page differs.
  2. The same unweighted.
  3. Across waves: wave 2 against wave 1 under the segment, BMW's change at four stages equals the difference of the
     two segmented references; the trend's wave 1 point is segmented.
  4. Missing answer: five blank genders (CSV with the pack's codebook) are outside a Man-or-Woman segment (54 of 59).
  5. A segment of 3 (Another identity, 18-24): every funnel share and media share suppressed, base 3; an empty segment
     refused with the reason by the loader and by the action.
  6. A segment code absent in the compared wave (wave 1's gender list without Woman): `previous` withheld with "Gender
     answer code 2 is not in the previous wave's answer list of Gender", every change carries it, the wave's trend
     point failed with it, wave 2's figures still equal the reference; without a segment the same waves compare; the
     segment opened on that wave is refused.
  7. Weight rescaling: weights times 2.5 leave every one of the more than 100 segmented figures equal to 1e-9, the
     effective base equal, the weighted total times 2.5.
  8. The profile questions offered (gender, age_band, province, settlement, income, life_stage), a non-profile question
     refused, CSM refused, a malformed segment refused at the action.
  Shown failing without the change: with `withSegment` returning the request unchanged, test 1 fails
  ("overview: expected 1000 to be 228").
- `src/lib/__tests__/trackerSegmentCodex.db.test.ts` (3 tests; real database, actual engine): every figure the loaders
  show for the segment against Codex's independent reference, copied unchanged to
  `fixtures/tracker-packs/bmw_car/independent/codex-segment-reference-2026-10-30.json` (sha256 680f3205...; computed by
  Codex's script from the same SPSS files, whose hashes the test checks: wave 1 bc8009ce..., wave 2 e19978de...). Both
  waves, weighted and unweighted: segment base (raw n, weighted total, Kish effective base), every page 01 cell by
  variable (awareness, consideration, shortlist, first choice, and ownership, read as usage), all 100 association cells
  and each brand's aware base and effective base, every moment recall cell shown (Codex's all-segment base), all twelve
  media shares, decision style and acquisition channel shares and bases, the three repertoire means (from Codex's
  distributions, sum of code x share / 100), and wave 2 minus wave 1 for awareness and consideration of every brand.
  The file states no tolerances, so ours: shares, changes and means 1e-6 points, raw bases exact, weighted totals and
  effective bases 0.051 (engine one decimal). Result: weighted 990 figures compared, 0 disagreements; unweighted 966
  compared, 0 disagreements. Not compared: Codex's pooled two-proportion z and p on Kish bases, because the dashboard
  computes no significance for a change (contract D3, "in points, no significance claim"); Codex's ownership and
  past-12-month acquisition rows that the dashboard does not show; its per-category repertoire distributions (the
  dashboard shows only the mean). Shown able to fail: with the segment's age codes narrowed to 25-34 only, 988 of 990
  weighted figures disagree.
- `src/lib/__tests__/trackerSegment.test.ts` (5 tests, pure): profile question list and exclusions, the boundary
  shapes, resolve with reasons, the filter shape and order, the cross-wave rule.
- `src/lib/__tests__/trackerSegmentPanel.test.tsx` (3 tests, mounted `TrackerDashboardPanel` in linkedom; server
  actions mocked and held): Apply sends codes; switching Woman then Man, Man's answer first, Woman's late answer
  ignored; remembered per project; refused segment shows the reason and "Clear the segment"; storage throwing.
  Shown failing without the panel's request guard (`if (id !== latest.current) return` in `reload` removed): the
  first test fails on the later segment's base line ("expected ... to contain 'Segment: Man; n=480'").
- `scripts/crosstab_selftest.py`: "codes filter" (OR within, AND with a range, labels in the note, empty and unknown
  codes refused, two codes sharing a label kept apart, blank outside, unlabelled CSV) and "subset share" (a seeded
  file where numpy gives 1.0000000000000002; the table reads exactly 100% with se 0; without `_subset_share` it raised
  "math domain error").
- `e2e/ui/tracker-segment.check.mjs` (browser, disposable stack): see Checks run.

## Checks run

All in `/home/claude/b126` on commit `28a12ed` (code) plus the check's Close-button fix in the docs commit.

| Gate | Command | Result |
|---|---|---|
| Types | `npx next typegen`, then `npx tsc --noEmit` | exit 0 |
| Lint | `npx eslint src e2e --quiet` | exit 0, 0 errors |
| Engine self-test | `python3 scripts/crosstab_selftest.py` | "All checks passed", 568 PASS lines (includes 8 "codes filter" and 2 "subset share" checks). An earlier run while the machine was loaded reported 2 failures in the indicator data reader self-test it calls (large FinData and IMF reads, empty error, a killed subprocess); `python3 scripts/indicator_selftest.py` alone passed, and this full rerun passed |
| Full library | `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false npx vitest run src/lib/__tests__ --pool=forks` | Test files 1 failed, 373 passed, 2 skipped (376); tests 5 failed, 2840 passed, 92 skipped (2937). The 5 failures are all in `outputSelectionIdentity.db.test.ts` (batch 65, untouched here), each "Test timed out in 5000ms" while the machine was loaded; rerun alone: 8 of 8 passed |
| Codex reference and segment tests | `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres npx vitest run src/lib/__tests__/trackerSegmentCodex.db.test.ts src/lib/__tests__/trackerSegment.db.test.ts src/lib/__tests__/trackerSegment.test.ts --pool=forks` | 3 files, 16 of 16 passed (after the Codex reference was added) |
| New tests alone | same environment, `npx vitest run src/lib/__tests__/trackerSegment.db.test.ts src/lib/__tests__/trackerSegment.test.ts --pool=forks`; `npx vitest run src/lib/__tests__/trackerSegmentPanel.test.tsx` | 13 of 13 passed; 3 of 3 passed |
| Browser, new check | production build (`next build --webpack` in `/home/claude/b126build`, a copy of the commit with the shared node_modules linked, `NEXT_FONT_GOOGLE_MOCKED_RESPONSES=scripts/e2e/font-mock.cjs`, a throwaway `ie_test_build_r5seg` database on the local test server, dropped afterwards); stack `E2E_NEXT_START=/home/claude/b126build E2E_APP_PORT=3380 E2E_STORAGE_PORT=3381 E2E_ADMIN_DATABASE_URL=postgres://postgres@localhost:55432/postgres node scripts/e2e/local-stack.mjs`; `SHOT_DIR=... npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1 tracker-segment` | Run 1: failed, "page.goto: Page crashed" (browser out of memory on the loaded machine, before the dashboard opened). Run 2: steps 1 to 3 passed and their screenshots were taken; it then timed out at 15 minutes on the dashboard's close button, whose name in the Analytics grid is "All analytics", not "Close" (a fault in the check). Fixed the check (button name, 30 minute limit). Run 3: passed (2.9 min) |
| Browser, tracker suite | `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1 tracker-` | 9 passed (13.8 min): advertising, associations, audience, category, dashboard (3 tests), moments, segment |

Not run: the full browser suite (`ui-check.config.mjs` without a filter) and the smoke suite, for time and memory on
the shared machine.

Screenshots (1440 x 900, production build): `/tmp/claude-0/-home-claude/2029d29d-347f-5d3f-9a5d-a57af1db9390/scratchpad/segment/`
`segment-picker.png`, `segment-overview.png`, `segment-associations.png`, `segment-audience.png`, `segment-cleared.png`.

## Mocks versus real

Real: PostgreSQL (disposable database per test file), the Python engine, the BMW pack files, pandas references,
the browser stack (production build, `next start`). Mocked: object storage (in-memory stand-in), the model (stubbed,
never called), and in the mounted test the server actions (the boundary whose answer order is under test).

## Limits

- CSM dashboard: no segment (above).
- A segment question must have an answer list (labels); a raw file without labels offers no profile questions until a
  codebook or labels file is linked.
- Profile questions are those `demographicKindOf` recognises by name or label; a profile question worded otherwise is
  not offered (no free choice of any variable).
- Cross-wave identity of a code is by its label (the brand rule): a relabelled answer is withheld, a code whose label is
  unchanged but whose meaning changed cannot be told.
- Small segments: the engine suppresses each figure under 10 valid answers; the page-level small-base flags of Audience
  (below 50, below 30) apply to the acquirers within the segment as before. No extra segment-level warning.
- Remembered per browser only; another browser or colleague starts on all eligible.

## Merge notes

- Other sessions are redesigning `TrackerDashboardPanel.tsx` and adding background page loading: the panel edits here
  are grouped (search "R5"). The six actions now take a trailing `segment` argument; a page cache must key on
  `segmentKey(segment)` (exported from `SegmentPicker.tsx`). The `Card` component renders `CardSegmentBase`; a
  redesigned card must keep a base line that names the segment.
- Provenance consumers (findings from the dashboard, AI insights, slides on another branch) must record the page's
  `segment` (`BrandOverview.segment`, `figures.segment`, and `segment` on each page result: questions with codes and
  labels, text, the engine filters and the base) and must not present a segmented figure as all eligible.
- `PreviousWave` has a new `"withheld"` status; any consumer switching on it must handle it.
- `CrosstabFilter.op` has a new value `"codes"` with `codes`; `filterText` in `CrosstabFilters.tsx` describes it.
- Starter tables now also recognise income and household life stage as banners (after employment).
- Do not edit `docs/current-engineering-status.md` (not touched here).
