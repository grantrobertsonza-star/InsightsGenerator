# Batch M4 handover: brand dashboard pages 04, 05 and Category overview (29 October 2026)

Status: **implemented, ready for independent review.** Tier A (trackerRoles.ts, trackerFigures.ts, and the new
trackerAdvertising.ts, trackerAudience.ts, trackerCategory.ts, trackerDashboardActions.ts) with a tier B screen
(TrackerDashboardPanel.tsx). Branch `brandpages`, worktree b104. Three commits, one per page:

| Page | Commit |
|---|---|
| 04 Advertising & WOM | `b293bab` |
| 05 Audience & media | `9de2364` |
| Category overview (Grant's page 08; sixth entry of the app's menu) | `bc0c73a` |

This handover is committed separately after them.

## What changed

- The brand dashboard's left menu: every page is now a button (Brand overview, Moments & needs, Brand associations,
  Advertising & WOM, Audience & media, Category overview); Brand overview stays the default. The "Coming next" state is
  gone with the code that drew it. Below the `lg` width the six pages are tabs above the page (they wrap). The menu
  numbers a page by its place, so Category overview shows as 06 (Grant's design calls it page 08; the app's menu has
  no pages 06 and 07 of that design). Each page has the same chips row and its own request counter, so a late answer
  (after a reload, a file switch or closing) is dropped; a reload of the dashboard resets every page to load again.
- **Page 04 Advertising & WOM** (`loadBrandAdvertising`, `loadBrandAdvertisingAction`). Left card "Advertising
  recall": a ranked bar per brand (yes share), the client's brand highlighted, "not sure x%" beside each bar, n stated,
  footnote "Self-reported recall is not verified ad exposure or an estimate of media effectiveness." Right card "Word
  of mouth: Exclusive groups; all eligible respondents; n=1,000": a stacked 100% bar per brand (client's brand first),
  legend with every answer of the question (Mainly positive, Mainly negative, Mixed, Neutral, Not heard) and Unaware,
  the client's brand's six shares printed under the bars.
- **Page 05 Audience & media** (`loadBrandAudience`, `loadBrandAudienceAction`). Small-base banner by the unweighted
  count of the client's brand's recent acquirers: below 30 "VERY SMALL BASE: BMW recent acquirers n=13. Descriptive
  illustration only. No significance, targeting or market inference."; 30 to 49 "SMALL BASE ... Read with caution; no
  significance test is applied."; 0 says nobody acquired and the acquirer figures are n/a. Left card "Age profile"
  (acquirers vs all eligible category respondents, paired bars per age group), right card "Media use" (multiple
  response; media habits, not advertising effectiveness; paired bars ordered by the category's share).
- **Category overview** (`loadCategoryOverview`, `loadCategoryOverviewAction`). Three tiles: "Brand repertoire"
  (recognised, considered, acquired: mean per respondent, tracked brands only, Other excluded), "How decisions are
  made" (single-response shares), "Most recent acquisition channel" (single-response shares among those who answered).
- Recognition (trackerRoles.ts), new fields of `recogniseTracker`, each never from a variable name alone and two
  candidates "ambiguous": `advertisingRecall` (`findAdvertisingRecall`: per-brand wording, stage advertising, not
  unprompted; the wording whose answers keep "not sure" apart is the question as asked, because the codebook files the
  routed question and its derived all-sample indicator under one question ID AD2), `ageGroups` (`findAgeGroups`),
  `mediaUse` (`findMediaList`), `decisionStyle` (`findDecisionStyle`), `acquisitionChannel` (`findAcquisitionChannel`).
  `labelAfterName` is now one function used by `findCategoryMoments` and `findAdvertisingRecall` (behaviour of
  `findCategoryMoments` unchanged; trackerMoments tests pass unchanged).
- Shared readers (trackerFigures.ts): `stageClaims` (the per-brand questions mapped to a stage, now also used by
  `overviewMeasures`, whose output is unchanged) and `answersOf` (every answer of a single-choice question by raw code
  from the total column, unrounded, a suppressed figure null, never read from the rounded one).

## Figure contracts

In `claude/d2-design-2026-10-29.md`, "D3e Advertising & WOM", "D3f Audience & media", "D3g Category overview", with
registry rows in `claude/rules-registry.md` and rules 5a to 5c in `claude/tracker-roles.md`. In short:

- **Prompted recall of X** = weighted yes / weighted valid answers to X's prompted recall question (those asked; in
  BMW those aware of X); not sure in the base, never yes or no, reported apart (`excludeDk: false`).
- **Word of mouth group g of X** = weighted count giving answer g (or, for Unaware, whose awareness answer for X is not
  the aware code) / weighted count of all eligible; shown only when one table of the answer by awareness shows the
  groups exclusive and complete (every aware respondent answered, no unaware one did); otherwise X is n/a with both
  counts. Adds to 100.
- **Recent acquirers of the client's brand**: its selected code in the question mapped to acquisition, selected by an
  engine filter on the raw code. **Age group a** / **medium m** among a group = weighted share among that group's valid
  answers (every age code kept; "None of these" in the media base). Small bases by the unweighted count: below 50
  flagged, below 30 descriptive only; no difference, index or significance computed at any base.
- **Repertoire at stage S** = sum over listed brands of each brand's selected share / 100, equal to the weighted mean
  number of brands per respondent; shown only when every brand's base is every respondent (else n/a). **Decision
  style** and **acquisition channel** = each code's weighted share among valid answers, every code kept.
- All through `computeCrosstab` (nothing saved; each page's test counts `document_tables`), by raw code, with the
  dashboard's weight (`resolveDashboard`) and the file's survey design.

## Impact checklist

1. **Rule:** three new rules, each with a registry row and contract (above). Owners used, no second version:
   `computeCrosstab` (engine, filters by raw value), `selectedCode` / `selectedAnswerOf` / `selectedShareOf` (selected
   answer by code), `overviewMeasures` (awareness, as pages 01 and 03), `resolveDashboard` (weight, stage choices,
   client's brand), `loadRoleInput` / `recogniseTracker` (recognition). New shared readers `answersOf` and
   `stageClaims` sit with the existing ones in trackerFigures.ts.
2. **Inputs:** every part the file lacks is "Not measured" with the reason; two candidates, or a needed choice not
   made (awareness, the client's brand, a stage claimed twice), "Mapping needed"; a figure that cannot be read (code
   not told, not numeric, suppressed, blank answers in a repertoire, groups not exclusive, nobody acquired) is n/a with
   the reason, never 0. A file whose dictionary, set-up or table cannot be read rejects with the reason (the page
   shows the error and "Try again"); each page's database test covers it.
3. **Persistence:** none. The pages read only; no table, finding or choice is saved.
4. **Freshness:** no stored derived result depends on these pages; nothing to mark stale. Each page reloads when the
   dashboard reloads (after a saved choice such as weighting, a stage or the client's brand).
5. **Screens:** each page loads only when shown, with its own request counter; reload resets it; no "saved" state.
6. **Proof:** below.

## Checks run (worktree /home/claude/b104)

After each page: `npx next typegen` ok; `npx tsc --noEmit` 0 errors; `npx eslint src e2e --quiet` 0 errors (exit 0, no
output); `python3 scripts/crosstab_selftest.py` "All checks passed" (551 PASS lines, 0 FAIL). Vitest with
`TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false npx vitest run <files> --pool=forks`
(no database role error occurred, so no rerun was needed):

| After | Files | Result |
|---|---|---|
| Page 04 | trackerAdvertising.test.ts, trackerAdvertising.db.test.ts, trackerRoles, trackerRolesRaw, trackerFigures.db, trackerMoments, trackerMoments.db, trackerAssociations, trackerAssociations.db, trackerInput.db, trackerD3aRepairs | 11 files, 138 tests passed, 0 failed |
| Page 05 | the above plus trackerAudience.test.ts, trackerAudience.db.test.ts | 13 files, 154 tests passed, 0 failed |
| Category overview | the above plus trackerCategory.test.ts, trackerCategory.db.test.ts, trackerDashboard.test.ts, trackerNoFigures.test.ts | 17 files, 194 tests passed, 0 failed |

New tests: trackerAdvertising.test.ts 13, trackerAdvertising.db.test.ts 5, trackerAudience.test.ts 11,
trackerAudience.db.test.ts 5, trackerCategory.test.ts 9, trackerCategory.db.test.ts 5.

**Failing without the change** (each restored and rerun green afterwards):
- Page 04: without `excludeDk: false` on the recall table (the engine then drops "Not sure" as don't know),
  trackerAdvertising.db.test.ts had 3 of 5 failing (Haval weighted `42.02 to be close to 39.00`; unweighted; boundary
  BMW `56.64 to be close to 48.73`).
- Page 05: without the acquirers' filter (`filters: []`, i.e. everyone as the acquirers), trackerAudience.db.test.ts
  had 3 of 5 failing (acquirers' effective base 961.8 instead of at most 13; `acquirers age 1: expected 16.1 to be
  close to 23.08`; boundary likewise).
- Category overview: without the every-respondent base check (a partial sum), the boundary test failed (the
  considered repertoire was given a mean instead of n/a).

Not run: the full vitest library; the browser suites (no playwright, as instructed). Written, **not run**:
`e2e/ui/tracker-advertising.check.mjs`, `e2e/ui/tracker-audience.check.mjs`, `e2e/ui/tracker-category.check.mjs`;
`e2e/ui/tracker-moments.check.mjs` and `e2e/ui/tracker-associations.check.mjs` were updated (every menu entry is a
button; six tabs). There is no screenshot from this batch.

## Reference values

Each database test compares the loader's figures, to 1e-6, with a pandas helper written from the pack's
specification (not from the app): `src/lib/__tests__/helpers/advertising_reference.py`, `audience_reference.py`,
`category_reference.py`. BMW wave 1, SPSS with labels only, 1,000 respondents, weighted and unweighted:

- Page 04: all ten brands' yes and not sure shares and bases (BMW weighted 33.5437% yes, 7.1644% not sure, base 831)
  and all 60 word of mouth groups (BMW weighted 31.32 / 4.83 / 10.17 / 6.66 / 29.79 / Unaware 17.23, adding to 100);
  the reference takes Unaware as a blank word of mouth answer, as the pack defines it, so it is independent of the
  app's awareness-based reading. Boundary CSV (first 60, metadata.json as codebook): three BMW not sure answers in the
  base, two blanks outside it (base 47), a Ford answer from a respondent unaware of Ford makes Ford n/a.
- Page 05: BMW's 13 recent acquirers (very small) and all eligible: four age groups (acquirers weighted 23.58 / 21.14 /
  27.24 / 28.04; category 15.99 / 17.49 / 28.70 / 37.82) and twelve media, each with its base. Boundary CSV: 35
  acquirers (small), two blank ages (age base 33), a respondent using no listed media in the media base (35); nobody
  acquiring BMW; no age or media question.
- Category overview: repertoires weighted 8.1490 recognised, 3.6847 considered, 0.2194 acquired (unweighted 8.15,
  3.695, 0.221), each also equal to the weighted mean of the pack's own derived `n_aware`, `n_consider`, `n_bought12`;
  three decision style shares (base 1,000) and seven channel shares (base 234, Other 1.28% weighted). Boundary CSV: a
  blank consideration answer (n/a), two blank decision styles (base 58), a channel answer of Other kept, listed
  channels nobody chose 0.

The repository's pack copy has no advertising, word of mouth, demographic, media or category rows of the pack's
`reference_results.json`, so the pack's own published values for these pages were not compared.

## Mocks versus real

Real: disposable PostgreSQL, the Python engine (computeCrosstab, filters, value labels), the codebook import and
linking, the dashboard choices (saveTrackerChoices for unweighted and for stage choices). Mocked: storage (in-memory),
request context, `next/cache`, `next/server`, API usage logging, the model (throws if called). Unit tests use
hand-built Cross tab results for the pure helpers and the recogniser fixtures (fixtures/tracker-roles, tracker-raw).

## Files

- `src/lib/trackerRoles.ts` (advertisingRecall, ageGroups, mediaUse, decisionStyle, acquisitionChannel; the find*
  functions; notSureCodes; labelAfterName)
- `src/lib/trackerFigures.ts` (stageClaims, answersOf; overviewMeasures through stageClaims)
- `src/lib/trackerAdvertising.ts`, `src/lib/trackerAudience.ts`, `src/lib/trackerCategory.ts` (new)
- `src/lib/trackerDashboardActions.ts` (three actions)
- `src/app/runs/[id]/TrackerDashboardPanel.tsx` (three pages, menu, tabs)
- Tests: `src/lib/__tests__/trackerAdvertising.test.ts`, `trackerAdvertising.db.test.ts`, `trackerAudience.test.ts`,
  `trackerAudience.db.test.ts`, `trackerCategory.test.ts`, `trackerCategory.db.test.ts`, helpers
  `advertising_reference.py`, `audience_reference.py`, `category_reference.py`; browser checks (written, not run)
  `e2e/ui/tracker-advertising.check.mjs`, `tracker-audience.check.mjs`, `tracker-category.check.mjs`; updated
  `tracker-moments.check.mjs`, `tracker-associations.check.mjs`
- Docs: `claude/d2-design-2026-10-29.md` (D3e, D3f, D3g), `claude/rules-registry.md`, `claude/tracker-roles.md`
  (rules 5a to 5c), this handover

Callers checked: `recogniseTracker`'s new fields are additive (only the new loaders read them); `overviewMeasures`
gives the same result through `stageClaims` (trackerFigures.db, trackerD3aRepairs, trackerAssociations,
trackerDashboard tests pass unchanged); `answersOf` and `stageClaims` are new and used only by the new loaders.

## Limits

- Labels say what the file says: the recall period ("four-week") and the media period ("seven days") of the pack's
  guide are not in the data file, so the cards say "Prompted recall" and "Media use" and quote the question wording.
- The channel card says "among those who answered" and that the question's routing decides who was asked; it does not
  check the routing against `last_acquired`.
- Prompted recall needs labelled answer lists; a raw file without labels (coffee Oldtracker, the BMW CSV without its
  codebook) shows "Not measured" for recall, age groups, media, decision style and channel. Media options known only
  by their variable names (Media_YouTube) are not read.
- Word of mouth needs every respondent to answer the awareness question for that brand; the Unaware group comes from
  the mapped awareness question.
- Page 05 shows the client's brand only (no brand picker on the page); no comparison of acquirers with the category is
  tested or worded at any base. Unweighted counts decide the small-base level.
- No change against the previous wave, no significance, no Segment other than "All eligible" on these pages; no
  switching (the plan's "switching from past and current brand") and no purchase journey card.
- One engine request per brand for word of mouth (11 in BMW wave 1).
- Not run: full vitest library, browser suites, the three new browser checks; no screenshot.
- Housekeeping: while running the page 05 gates, one background command left the shell in `/home/claude/b101`, so a
  vitest run of the existing tracker tests executed there (read-only; `git status` in b101 clean afterwards) and wrote
  its log to `/vt5.txt` at the filesystem root, which the safety check did not let me delete. It can be removed by hand.
