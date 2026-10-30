# Batch R5 waves handover (30 October 2026)

Status: **implemented, ready for independent review.** Branch `r5waves`, base `b3e230f`. Approved by Grant: wave
switching, the change against a chosen wave on every page of the Brand tracking dashboard, and a significance test
for those changes. No migration. Contract: `claude/wave-change.md` (new). Registry: three rows added or changed in
`claude/rules-registry.md`.

## What changed

1. **Wave selector.** The Wave chip is a selector of the project's included waves in the owner's order
   (`waves.projectWaves` through `waveFiles.loadProjectWaves`; no new order rule): excluded waves are not offered and
   are named as left out; undated waves say "no fieldwork date" and the order basis is shown. Choosing a wave reloads
   every page for that file and keeps the page, the client's brand, the Compare brands and weighting. The choices
   stay on screen while a wave loads ("Loading Wave N...") and after a failure (Try again). Only the latest choice's
   answer is shown.
2. **Compare with.** Previous included wave by default, any earlier included wave, or None. Checked at the action
   boundary (`compareChoiceFrom`) and on the server against the included waves (`comparisonTarget`): a chosen wave
   that is excluded or not earlier gives no change with the reason, never a substitute.
3. **Change on every page** against the chosen wave: 01 tiles and funnel (generalised from "previous"), 02 category
   relevance and moment by brand recall, 03 each brand by attribute, 04 recall and word of mouth groups, 05 age and
   media for the acquirers and all eligible, Category overview decision style and channel shares (repertoire: change
   in brands, not tested). CSM dashboard: its existing changes use the chosen wave, not tested.
4. **Matching by identity only** (`claude/wave-change.md`, "Matching across waves"): brand by code with
   `codeNamesDiffer`; question by variable with the same wording and answer codes (`questionDiffers`, new, beside
   it); answer by code naming the same answer (`answerDiffers`, new); a base defined by another question needs that
   question to be the same too. Withheld figures carry the reason.
5. **Trend views.** Page 03: the client's brand's association with each attribute across the included waves up to
   this one, small multiples (`AssociationTrend.tsx`). Page 02's loader returns `relevanceTrend` (each moment's
   relevance per wave, matched by identity) for the Moment profile view another session is building; no view drawn.
6. **Significance** in the engine (`share_change_tests`), reusing the column test's `_pooled_prop_se`,
   `_p_two_sided` and `_p_two_sided_t`; design-based when a design is applied in both waves; states untested and
   failed never shown as "not significant". One line on each page: "Change marked when a two-sample test on effective
   bases gives p < 0.05; not adjusted for multiple comparisons." Marks: arrow and bold with spoken words; an
   asterisk for untested with its reason. Means (CSM, repertoire): no two-sample mean test with effective bases
   exists in the engine, so none is claimed.

## Impact checklist

1. **Rule.** Owners reused: `projectWaves` (order), `codeNamesDiffer` (E1R identity), the engine's column test
   functions, `selectedShareOf`/`answersOf` (readings). New rules with registry rows and contract: the compare choice,
   question and answer identity across waves, the two-sample share test. Mirror noted, not used: `src/lib/stats.ts`
   `twoProportionGap` (pooled z on raw n for banner plans, pre-existing).
2. **Inputs.** Missing compared wave, excluded or later choice, failed read, renamed brand, changed wording or answer
   list, suppressed or unknown share, bases under 30, no effective base (older engine output), design on one side:
   each gives no change or no test with the reason; nothing becomes 0, "no change" or "not significant".
3. **Persistence.** None. Nothing is saved: figures are computed (`computeCrosstab`), the wave and comparison are
   screen state. Saves of choices are unchanged (compare-and-swap against the wave shown).
4. **Freshness.** No derived artifact (finding, insight, narrative, export) uses these changes; nothing goes stale.
5. **Screens.** Late answers dropped by per-page request counters (mounted test); switching keeps page, brand and
   Compare; failure shows Try again with the choices usable; a chosen comparison no longer earlier than the new wave
   falls back to the previous wave.
6. **Proof.** Below.

## Files

Engine: `api/parse-stats-file.py` (`share_change_tests`, `nEffExact` on share bases and the table total, handler
branch reading no file), `scripts/parse_stats_worker.py`, `scripts/parse_stats_local.py`, `scripts/crosstab_selftest.py`.
Library: `src/lib/trackerWaveChange.ts` (new), `trackerPageChanges.ts` (new), `trackerWaveContext.ts` (new),
`parseStatsFile.ts` (`runShareChangeTests`, worker protocol 7), `trackerFigures.ts` (`ShareStat`, `shareStatOf`,
`answerStat`, `questionDiffers`, `answerDiffers`, `changesAgainst` questions), `trackerOverview.ts` (compare choice,
tests, wave list), `trackerDashboardActions.ts` (compare argument), page loaders `trackerMoments.ts`,
`trackerAssociations.ts`, `trackerAdvertising.ts`, `trackerAudience.ts`, `trackerCategory.ts` (context option, stats).
Screen (grouped, minimal panel edits): `TrackerDashboardPanel.tsx`, new `WaveSelector.tsx`, `ChangeBadge.tsx`,
`AssociationTrend.tsx`. Docs: `claude/wave-change.md`, `claude/rules-registry.md`, `claude/d2-design-2026-10-29.md`,
`claude/waves.md`. Tests: listed below. Callers checked: `AnalyticsBuilder.tsx` (opens the panel, unchanged), CSM
side of the overview (`csmChangesAgainst` now gets the chosen wave), existing tracker db and unit tests.

Wording changed in identity reasons: "in the previous wave" is now "in the compared wave" (five existing assertions
updated in `trackerD3aRepairs.test.ts`, `csmCompanyIdentity*.test.ts`, `trackerFigures.db.test.ts`).

## Proof

GATES_PLACEHOLDER

## Mocks versus real

- Real: PostgreSQL (disposable), the Python engine, pandas/numpy/scipy references, the browser on a production build.
- Mocked: Supabase storage (in-memory stand-in), request context; in `trackerWaveIdentity.test.ts` the engine call
  (its arithmetic is pinned elsewhere); in `trackerWaveSwitch.test.tsx` the server actions (held answers).

## Limits

- No multiple-comparison adjustment (stated on the page). Word of mouth groups are not tested under a survey design.
- Means are not tested (CSM, repertoire).
- A third BMW wave is synthesised from wave 2 (`helpers/make_wave3.py`); the pack has no published wave 3 values.
- The design-based path is pinned by the selftest only (no tracker fixture has PSUs or strata).
- The wave and comparison choices are not saved across visits.
- Other sessions are reworking `TrackerDashboardPanel.tsx`; this batch's edits there are grouped under "R5 waves".
