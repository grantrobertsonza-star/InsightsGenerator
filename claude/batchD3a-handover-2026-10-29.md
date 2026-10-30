# Batch D3a handover: tracker dashboard, brand and customer satisfaction tiles (29 October 2026)

Status: implemented, ready for independent review. Branch d3 (worktree b87), on top of BatchR1 (c94314d), which is on
top of BatchUI1R (0504ebf).

## What Grant gets

Analytics now has a **Tracker dashboard** tool. It opens on a data file and has two tabs.

- **Brand.** Seven funnel tiles (awareness, consideration, shortlist, first choice, trial, usage, frequent usage)
  showing the client's brand's share and its change since the previous wave file, in points. Below them is a
  brand-by-stage comparison of five brands (the client's first, then the file's list order), labelled as
  suggested, which the researcher can change on screen.
- **Customer satisfaction.** Tiles for overall satisfaction (top-two box and mean), Net Promoter Score (score,
  interval, promoters and detractors), likely to stay (top two), likely to switch (8 to 10 on a 0 to 10 scale) and
  driver priority (share of satisfaction explained by each driver).
- **Every standard tile always shows** (Grant, 29 October 2026). A tile with no question in the file, or two
  questions claiming it, is blank with "Choose a question". That button opens Customise at the matching choice. A
  tile whose figure could not be calculated says why and offers "Choose a different question".
- **Customise dashboard** sets the client's brand, weighting, the question for each funnel stage, each CSM role
  (or "None in this file") and the drivers. Apply changes saves them for the whole programme (D2's
  compare-and-swap). "Saved" appears only after the save succeeds. A conflicting save, or a project that has
  moved programme, reloads what is stored and says nothing was saved. Reset to suggested is the same as in D2.
- A blank tile has a small **Hide** button (Grant, 29 October 2026, for dashboards used in reports). Hidden tiles
  are saved at once for the programme, from the stored choices (never with an unapplied draft); "Show hidden tiles"
  brings them back. A hidden tile that gets a figure again shows anyway.
- A customer satisfaction file opens on the Customer satisfaction tab. Any other file opens on Brand.

## Rules and owners (rules-registry rows added)

- **Brand figures.** `trackerFigures.brandOverviewFigures` builds one Cross tab per file. Shares are read by
  answer code (`selectedCode`), never by label. A code that cannot be identified is "not available" with the
  reason, never 0. Change is computed by `changesAgainst`. The overview is assembled by
  `trackerOverview.loadBrandOverview`, and `suggestedComparators` gives the default comparison set.
- **Previous wave.** It is the wave file just before this one in `waveFiles.loadProjectWaves`, which is now the
  single database reader that Wave tracking also uses. It is resolved with the same saved choices. "None" (the
  earliest wave, or a file that is not a wave) and "failed" (its figures could not be read) are distinct states,
  and neither is ever shown as "no change".
- **CSM tiles.** `trackerCsmFigures.csmOverviewFigures` uses the existing owners:
  - `runDistributionAction` with `csmMetrics.summarizeSeries` (the CSM Analytics reading);
  - `runNpsAction` (the NPS tool's score and interval);
  - `runDriverAnalysisFor`.
- **No saved tables.** Opening a dashboard computes its tables without saving one. `crosstabs.computeCrosstab` is
  the computation that `buildCrosstab` already did, split out with no change to it, and `buildCrosstab` now calls
  it and then saves. `runNpsAction` and `runDistributionAction` take `table: "compute"` for this case. Their
  default, `"save"`, is unchanged for every existing caller.

## Impact checklist

1. **Rule:** the owners are listed above, and no figure is computed on the screen. Two new registry rows, the
   wave-reader row is updated, and `claude/d2-design-2026-10-29.md` (Generation, D3) holds the contract.
2. **Inputs:**
   - Missing role: blank tile with the reason.
   - Failed owner: failed tile with the owner's message.
   - Unreadable previous wave: "failed", with this wave still shown.
   - No brand list: the brand select says so, and the stage tiles are blank.
   - Weight: the dashboard's choice. Weighted is the default when the file has a weight.
   - Unknown is never 0.
3. **Persistence:** only D2's `saveTrackerChoices` and `resetTrackerChoices`, unchanged. The dashboard writes no
   table or finding. This is proved by counting `document_tables` before and after.
4. **Freshness:** nothing derived is stored, so every open recalculates from the current file, corrections and
   choices.
5. **Screens:**
   - Only the latest load may update the screen.
   - The panel is keyed by project and file, so switching files starts fresh.
   - "Saved" appears only after the save succeeds, and the dashboard then reloads.
   - A conflict or a moved programme reloads the stored choices.
6. **Proof:** see Checks.

## Checks (D3a-specific; full gates in the package note)

- `trackerFigures.db.test.ts`, 5 tests, real PostgreSQL and the real engine, BMW pack SPSS waves 1 and 2:
  - 40 brand-by-stage shares match `reference_funnel_w1_w2.json` to 1e-6, weighted;
  - unweighted when chosen;
  - wave 2 minus wave 1 matches the references' difference;
  - **opening the overview saves no table.** This test failed on the earlier version, which saved 2 tables;
  - an unreadable previous wave is "failed", and the change is unavailable with that reason.
- `trackerCsmFigures.db.test.ts`, 3 tests, banking CSM pack waves 1 and 2 as labelled SPSS
  (`fixtures/csm/banking_relationship_w{1,2}_labels.sav`, references in
  `fixtures/csm/reference_relationship_w1_w2.json`):
  - satisfaction mean and top-two box, likely to continue (top two) and switching risk (8 to 10) match the pack to
    1e-6, weighted;
  - NPS matches to within 0.05 (the NPS tool rounds to one decimal);
  - six driver shares sum to 1;
  - no table saved;
  - a role set to none gives a blank tile with the reason, and the other tiles still show;
  - an unreadable file gives failed tiles with the reason, which calculate again once the file is restored.
- `e2e/ui/tracker-dashboard.check.mjs`, 2 browser tests on the disposable stack:
  - BMW: 7 tiles, 2 of them blank (no trial or frequent-usage question); NPS shown (the main brand's recommendation question) and the other 4 CSM tiles blank; Trial hidden (6 tiles, "1 empty tile is hidden") and shown again; choosing BMW and
    applying shows the reference awareness and change; the choice is kept after a reload; the layout fits at
    760 px wide.
  - Banking: opens on Customer satisfaction with the reference figures; "Likely to stay" set to none becomes a
    blank tile; choosing the question again from the tile brings the figure back.

## Limits (not in D3a)

- No CSM change against the previous wave yet.
- No company or segment split. The banking pack's per-bank figures need a company question, which is next.
- No on-page filters (a Displayr follow-up, planned with D3).
- No significance on changes. Changes are described as points, with no test.
- The on-screen comparator selection is not saved.
- Driver priority runs a fresh analysis on each open (no saved analysis reused yet).
- "Likely to switch" reads the top three codes on a 0 to 10 scale. If code 10 is absent from a file's answer list,
  the top three are the three highest present (`summarizeSeries`).

## Gates

- On 8337d42 (the packaged code):
  - typecheck and lint clean;
  - engine self-test passed;
  - library 314 files, 2,387 tests passed, 91 skipped, 0 failed.
- Full browser suite on 1629e8a: 142 passed, 1 skipped, 2 failed, both explained:
  - `nps-driver-split`: this branch carries the UI1R check before its correction, which is already applied as
    BatchUI1R and BatchUI1R2.
  - `tracker-dashboard`, BMW test: the check's own errors, corrected afterwards:
    - the wave file's option is labelled "Wave 2: bmw_w2.sav";
    - BMW's NPS tile shows;
    - the wave labels are now read back after a reload;
    - the "Saved" note is now cleared by an edit. This last one was a screen change: an earlier "Saved" no longer
      sits beside unapplied edits.
- Smoke: 1 passed.
- `tracker-dashboard.check.mjs` on the final code: 2 passed.
- Two further changes after that run, both covered by the library run above:
  - five suggested comparators (the client's first);
  - a change that rounds to zero reads "±0.0".
- Screenshots: desktop, narrow (760 px), CSM, and a CSM blank tile.

Mocks: storage is an in-memory stand-in in the library tests. Everything else is real: PostgreSQL, the Python engine,
and the browser on the disposable stack.

