# Batch R3d6 handover: repairs for Codex D6-F01 and D6-F02 (30 October 2026)

Status: **implemented, ready for independent review.** Tier A (`src/lib/indicatorAnalyticsFigures.ts`,
`src/lib/indicatorAnalytics.ts`) and B (`src/app/runs/[id]/IndicatorAnalyticsPanel.tsx`), per
`node scripts/change-tier.cjs --base 55bcfa5`. No migration, no engine change, nothing written: the tile stays
read-only. Not pushed, not deployed, no Supabase write.

Source: `docs/independent-d3e-review-2026-10-30.md` (findings D6-F01 and D6-F02, Codex). D3E-F01 in the same
review is not part of this batch. Contract: `claude/indicator-analytics.md` (updated). Registry row: "Indicator
Analytics (D6)" in `claude/rules-registry.md` (updated).

Review targets, worktree `/home/claude/b108`, branch `r3d6`:

| Commit | Content |
|---|---|
| `55bcfa50e950a4b026e5afc79b86c24f50052b70` | parent (unchanged base) |
| `e926c4ac81be03e93f933ff4eeb77d0ccef56970` | D6-F01 code and tests |
| `ad2fc0f1fa8a020694ffcb24fb5441329e7aae0e` | D6-F02 code and tests |
| next commit | this handover, the contract and the registry row |

Blob hashes at `ad2fc0f`: `indicatorAnalyticsFigures.ts` `f9feba63`, `indicatorAnalytics.ts` `14faca17`,
`IndicatorAnalyticsPanel.tsx` `7431a3a7`.

## Impact checklist (AGENTS.md)

1. **Rule:** the Indicator Analytics (D6) registry row. Both repairs are in its owner
   (`indicatorAnalyticsFigures.ts`); the loader and screen consume it. The period form is read through the existing
   shared period rule `indicatorPeriodValid` (`src/lib/indicatorLayouts.ts`, mirror of the engine's
   `_ind_period_in_calendar`); no second period parser for validity was written. The time-axis placement is a new
   owner (`periodPlacement`, `timeAxisOf`, `axisFraction`), replacing the earlier `periodPosition` body; the
   registry row names it.
2. **Inputs:** a period that cannot be placed safely is never placed by order: the time-axis charts are withheld
   with the reason and the observed values listed. A change that rounds to zero is never treated as no change.
   Shown values that cannot be parsed as numbers (not reachable from the current display rules) fall back to the
   unrounded direction rather than to "the same".
3. **Persistence:** none. Read-only.
4. **Freshness:** the tile feeds no finding, insight, recommendation, narrative or export, so nothing downstream
   goes stale. The summary wording and change text shown on the screen change for affected cases on the next load.
5. **Screens:** the request ordering, stale reload and kept-open behaviour are untouched; the existing mounted test
   (`indicatorAnalyticsPanel.test.tsx`) still passes. The new mounted test opens the Trends tab.
6. **Proof:** below, per finding.

## D6-F01: summary falsely says unequal displayed values are the same

Why the tests missed it: the D6 test of "no change at the shown precision" (70.54 then 70.5) happened to have equal
shown values, so the summary read correctly there; no test had a rounded change of zero with different shown
values, or the converse (equal shown values with a rounded change of one step, which the old code called a rise
"from 1.1% to 1.1%").

Changes (`src/lib/indicatorAnalyticsFigures.ts`):
- `Change.direction` ("rose", "fell", "same") from the unrounded `value` only.
- `changeBetween` text: the unrounded change rounded once, as before; a nonzero change that rounds to zero keeps its
  sign and reads "smaller than one shown step" (`+<0.1 pp`, `-<1`). `0.0 pp` only for exact equality. The
  arithmetic adds ", calculated from the unrounded values" when the rounded change differs from the difference of
  the shown values.
- `viewSummary` uses `movement`, which reads shown equality from the two shown values at their own precision
  (`shownValueOf`) and the direction from `Change.direction`; four cases, each agreeing with both shown values
  (contract, "What this view says").
- One existing expectation changed deliberately: 70.54 then 70.5 now has change text `-<0.1 pp` (was `0.0 pp`) and
  the summary "is shown as 70.5% in both 2020 and 2021; unrounded, it fell (change -<0.1 pp)." (was "the same at
  the shown precision").

Acceptance criteria:

| Criterion (review) | Met by | Test |
|---|---|---|
| Separate numerical direction, shown-value equality and rounded-change formatting | `Change.direction`, `shownValueOf`/`movement`, `changeBetween` text | all D6-F01 tests |
| Never assert equality because a rounded difference has no sign | "the same" only when `direction` is "same" (unrounded equal) | review case, negative case, unit scaling |
| Keep the contracted calculation from unrounded values | `value` unchanged; rounding once unchanged | DHS test (+19.7 pp), `indicatorAnalytics.db.test.ts` reference |
| Narrative consistent with both displayed observations | `movement` cases | all D6-F01 tests |
| Positive and negative differences straddling a rounding boundary | 1.04 to 1.06 (rose, `+<0.1 pp`), 1.06 to 1.04 (fell) | "the review's case", "a negative difference" |
| Genuinely equal shown values | 1.05 and 1.14 shown 1.1% both, `+0.1 pp`; 70.54 and 70.5 | "genuinely equal shown values", existing "a fall" test |
| Exact equality | 70.5 and 70.5 ("was the same", `0.0 pp`); 70.5 and 70.50 (both shown values named, `0.00 pp`) | "exact equality" |
| Differing observation precisions | 1.04E0 (shown 1% by the display rule) then 1.03 (1.03%): shown order against the unrounded fall, said so | "differing observation precisions" |
| Unit scaling | multiplier 3 (3,427 to 3,428, `+<1`); proportion scale (1.1% to 1.0%, `-<0.1 pp`) | "unit scaling" |
| DHS 19.7 pp reference and non-causal wording | unchanged statement and detail; no causal words | "the DHS reference", `indicatorAnalytics.db.test.ts`, `indicatorAnalyticsPanel.test.tsx` |

Before and after (test file `src/lib/__tests__/indicatorAnalyticsFigures.test.ts` at `e926c4a`):
- Without the fix (that file run against `indicatorAnalyticsFigures.ts` from `55bcfa5`): **8 failed, 13 passed (21)**.
  The review's case fails on the statement: received "For X, the reported value was the same at the shown
  precision ...", expected "... rose from 1.0% in 2020 to 1.1% in 2021." The negative and unit-scaling cases fail
  the same way; the equal-shown case fails because the old code said "rose from 1.1% ... to 1.1%"; the
  two-precision case because it said "fell from 1% ... to 1.03%". The DHS test fails only on the new `direction`
  field (its statement and +19.7 pp already passed).
- With the fix: **21 passed (21)**.

## D6-F02: Daily Trends panels place the same date at different horizontal positions

Why the tests missed it: every D6 test used annual DHS periods (or quarters), which `periodPosition` placed, so the
panel-local index fallback was never exercised; no test compared coordinates across panels.

Changes:
- `src/lib/indicatorAnalyticsFigures.ts`: `periodPlacement` places every form of the shared period rule at the day
  number of its first day (years, halves, quarters, months in both spellings, dates, ISO weeks at their Monday,
  week 1 being the week with 4 January); it answers a reason for a period the rule refuses or an ISO week 53 in a
  52-week year. `periodPosition` returns that day number (was a fractional year, with no dates or weeks).
  `timeAxisOf` is the view's one axis over the periods of every area in the range, withheld with the reason when a
  period cannot be placed or the periods mix frequencies. `axisFraction` is a position's share of that axis.
- `src/lib/indicatorAnalytics.ts`: `axis` is now `TimeAxis` (`calendar` with frequency, min and max, or `withheld`
  with the reason), from `timeAxisOf`; it was `{min, max} | null`.
- `src/app/runs/[id]/IndicatorAnalyticsPanel.tsx` `DotChart`: x is `axisFraction` on the view's axis only. The
  index fallback is removed. When the axis is withheld (or a point is off it) the chart shows the reason and lists
  the observed values in period order. The Trends intro says "the same time axis" only when there is one, else
  gives the reason.
- `src/lib/__tests__/indicatorAnalytics.db.test.ts`: the quarter position expectation is now the day number of
  1 January 2026, and the axis is asserted as quarterly.

Acceptance criteria:

| Criterion (review) | Met by | Test |
|---|---|---|
| One common time-axis owner for all accepted calendar period forms, dates and ISO weeks included | `periodPlacement`, `timeAxisOf`, `axisFraction` | D6-F02 pure tests |
| Used by all panels; never panel-local point indexes | Overview trend and every Trends panel use `DotChart` over `v.axis`; index fallback removed | mounted calendar test |
| Unequal country coverage | Ghana 2 dates vs Kenya 3; weeks: Kenya 4, Ghana 2, Nigeria 1 | mounted test cases 1 and 2 |
| Common date with different point indexes (Ghana/Kenya 2 January: equal cx) | Ghana's 1st point and Kenya's 2nd point share cx | mounted test case 1 |
| Irregular gaps | 1 to 2 January is one ninth of 2 to 11 January on screen; 2021-W01 to W05 is four weeks | mounted test cases 1 and 2, pure test |
| Single-point country | Nigeria's one point at Kenya's 2021-W05 cx, not the panel middle | mounted test case 2 |
| Weeks across a year boundary placed correctly | 2020-W52, 2020-W53 (28 Dec 2020), 2021-W01 (4 Jan 2021) a week apart; 2026-W01 on 29 Dec 2025 | mounted test case 2, pure test |
| Existing annual, quarter and month cases | years, quarters, halves, months (both spellings) at their first day; DHS annual and OECD quarterly loader tests | pure test, `indicatorAnalytics.db.test.ts` |
| Withhold an unsupported time-axis view explicitly | 2021-W53, a refused period, mixed frequencies, no period: `withheld` with the reason; values listed | pure test, mounted test case 3 |
| Mounted test like the review's (react-dom in linkedom, real launcher and loader over a stand-in stored read) | `indicatorAnalyticsCalendar.test.tsx` | 3 tests |

Before and after (`indicatorAnalyticsFigures.test.ts` and `indicatorAnalyticsCalendar.test.tsx` at `ad2fc0f`):
- Without the fix (run against the sources of `e926c4a`, which has D6-F01 but not D6-F02): **7 failed, 20 passed
  (27)**. The mounted review case fails exactly as the review saw: `expected 40 to be 328` (Ghana's and Kenya's
  2 January cx). The weeks case fails `expected 40 to be 232`; the 2021-W53 case draws 3 circles where none are
  expected; the pure tests fail on positions (dates at day 0 apart) and `timeAxisOf is not a function`.
- With the fix: **27 passed (27)**.

## Gates (all in `/home/claude/b108`, at `ad2fc0f`)

| Command | Result |
|---|---|
| `npx next typegen` | Types generated successfully, exit 0 |
| `npx tsc --noEmit` | exit 0, no output |
| `npx eslint src e2e --quiet` | exit 0, 0 errors |
| `python3 scripts/crosstab_selftest.py` | All checks passed, exit 0 (555 PASS lines, 0 FAIL) |
| `python3 scripts/indicator_selftest.py` | All indicator checks passed, exit 0 (122 PASS lines, 0 FAIL) |
| `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false npx vitest run <10 files> --pool=forks` | **10 files, 87 passed, 0 failed, 0 skipped**, first run (no database role error) |

The ten vitest files: `indicatorAnalytics.db.test.ts` (6), `indicatorAnalyticsCalendar.test.tsx` (3),
`indicatorAnalyticsFigures.test.ts` (24), `indicatorAnalyticsPanel.test.tsx` (1), `indicatorChartOptions.test.ts`
(3), `indicatorData.db.test.ts` (12), `indicatorData.test.ts` (21), `indicatorDataBeforeMigration.db.test.ts` (3),
`indicatorDisplay.test.ts` (13), `keptOpenWorkspace.test.tsx` (1). Playwright not run (as instructed).

## Mocks versus real infrastructure

- Real: the figures owner and loader in every test; the engine and a disposable PostgreSQL database in the `.db`
  tests (DHS reference, OECD quarters); react-dom mounting the real `IndicatorAnalyticsLauncher` in linkedom.
- Stood in: in the two mounted tests, the server actions call the real loader directly, and `listIndicatorFiles` /
  `loadIndicatorSeriesRead` return a fixed stored read (the database read boundary). Coordinates are read from the
  rendered SVG `cx`, not from a helper.

## Limits and follow-ups

- The shared period rule (engine `_ind_period_in_calendar`, mirror `indicatorPeriodValid`) accepts ISO week 53 in
  every year. The chart now withholds the axis for such a period with the reason, but the reader still stores it.
  Tightening the rule (engine, mirror and `indicatorData.test.ts`) is a separate tier A change to the period rule
  owner and was not made here.
- The Indicator data tab's chart (`indicatorDisplay.periodAxis`) is a different screen with its own axis rule (gap
  filling for years, quarters and months; observed order for other spellings, including weeks and dates). It was
  not part of either finding and is unchanged.
- Quarters and months are placed at their first day, so quarters are 90 to 92 days apart on screen rather than
  exactly equal; this is the true calendar spacing.
- Views mixing frequencies are withheld rather than drawn; a series is one frequency, so this is not expected from
  current readers.
- The browser check `e2e/ui/indicator-analytics.check.mjs` was not run (no Playwright in this batch); the DHS
  annual case it covers does not exercise either repair beyond the unchanged reference values.
- The review document `docs/independent-d3e-review-2026-10-30.md` is untracked in this worktree and was not
  committed by this batch.
