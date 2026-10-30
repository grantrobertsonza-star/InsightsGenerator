# Wave switching and wave-on-wave change on the brand tracking dashboard (R5 waves, 30 October 2026)

Approved by Grant, 30 October 2026: wave switching, the change against a chosen wave on every page, and a
significance test for those changes. Status: implemented, ready for independent review.

## Which waves, which comparison

- **Waves offered.** The Wave chip is a selector of the project's included waves, in the order of their owner
  (`src/lib/waves.ts` `projectWaves`, read by `waveFiles.loadProjectWaves`): fieldwork order when every included wave
  has a date, otherwise upload order with the waves lacking a date named (`waveOrderText`). Excluded waves are not
  offered; they are named as "Left out of wave tracking". Undated waves are listed with "no fieldwork date". No new
  order rule. `trackerWaveChange.waveListOf` builds the list; every page's answer carries it.
- **Switching.** Choosing a wave reloads every page for that wave's data file, keeping the page, the client's brand,
  the Compare brands and weighting (all programme-level choices, resolved against the new file). While it loads, the
  choices stay on screen with "Loading Wave N..."; a wave whose figures fail shows the failure and Try again, and the
  choices still work. Only the latest choice's answer is shown: each page keeps a request counter, and an answer to an
  earlier wave or comparison is dropped (`TrackerDashboardPanel.tsx`; mounted test `trackerWaveSwitch.test.tsx`).
- **Compare with.** The previous included wave by default, any earlier included wave, or None
  (`trackerWaveChange.comparisonTarget`). The screen's value ("previous", "none" or a wave file's id) is checked at the
  action boundary (`compareChoiceFrom`) and against the project's included waves on the server: a chosen wave that is
  excluded, not in the project, or not earlier than the wave shown gives no change with the reason, never a silent
  substitute. Switching to a wave at or before the chosen comparison sets the comparison back to the previous wave.
- **The compared wave's figures** come from the same page loader on its own file, with the programme's choices
  resolved against that file (`pagesToCompare`). If they cannot be read, the page shows this wave, says the compared
  wave failed with the reason and offers Try again; nothing is shown as "no change".

## Matching across waves (identity only)

A change is computed only between the same thing in both waves, never matched by label or position:

| What | Rule | Owner |
|---|---|---|
| Brand | the same code, naming the same brand in both waves' brand lists (trimmed, case ignored); a code renamed (Haval to Chery) is not compared | `trackerFigures.codeNamesDiffer` (E1R) |
| Question (stage, moment, attribute, recall, word of mouth, age, media, decision style, channel) | the same variable name, the same wording (its label, case and spacing ignored) and the same answer codes | `trackerFigures.questionDiffers` |
| Answer (a word of mouth group, an age group, a decision style, a channel) | the same code naming the same answer in both answer lists | `trackerFigures.answerDiffers` (the brand rule with "Answer") |
| Base defined by another question | an association's aware base, word of mouth's Unaware group and base, the recent acquirers: that question must also be the same variable and the same question | `trackerPageChanges.ts` |
| Brand repertoire (a mean over the listed brands) | the same brand list (every code the same brand) counted by the same variables, each the same question | `trackerPageChanges.categoryChanges` |

A figure that fails a rule has no change, with the rule's reason ("Brand code 10 was Haval in the compared wave, so it
is not compared."; "The answer codes of wom_b01 changed between the waves (1, 2, 3, 4, 5 then, 1, 2, 3, 4, 5, 6 now),
so it is not compared."). Changes are this wave's unrounded share minus the compared wave's, in percentage points
(the repertoire: in brands). A share unknown or suppressed on either side gives no change, with the reason.

## Pages

| Page | Changes | Tested |
|---|---|---|
| 01 Brand overview | every stage share of every brand (tiles and funnel) | yes |
| 02 Moments & needs | category relevance of each moment; moment by brand recall (the compared wave's cells are read for every moment, so a moment outside its own top six still matches) | yes |
| 03 Brand associations | each brand's association with each attribute, in points | yes |
| 04 Advertising & WOM | prompted recall (yes) per brand; each word of mouth group per brand | recall yes; word of mouth groups are tested on the effective base of all eligible without a design; under a survey design they are not tested (no design-based variance exists for a group put together from two questions) |
| 05 Audience & media | age groups and media use, for the recent acquirers and for all eligible | all eligible yes; the acquirers only when there are 50 or more in both waves (the page's small-base rule, D3f) |
| Category overview | decision style and acquisition channel shares; brand repertoire | shares yes; the repertoire is a mean, shown without a test |
| CSM dashboard | its existing changes now use the chosen wave | no (box shares, NPS and means: the engine has no two-sample mean test with effective bases, so none is claimed) |

Trend views: page 01 keeps its timeline (all included waves up to this one). Page 03 shows the client's brand's
association with each attribute across the included waves up to this one as small multiples
(`AssociationTrend.tsx`; waves other than this one and the compared one compute only the client's brand's table).
Page 02's loader returns `relevanceTrend`: each moment's category relevance in every included wave up to this one,
matched by variable and wording, for the Moment profile view another session is building; no view is drawn for it
here.

## The significance test

Owner: the engine, `api/parse-stats-file.py` `share_change_tests` (action `share_change_tests`, reads no file; signed
for the file whose figures are tested), called by `trackerWaveChange.attachTests` through
`parseStatsFile.runShareChangeTests`. It reuses the engine's column test functions; there is no second
implementation.

- **Inputs per side**, from the engine's own Cross tab of that wave: the unrounded share (`pctExact`), the unweighted
  base, the Kish effective base of that base from the weights (`nEffExact`, new: the unrounded `nEff`), and, when a
  survey design was applied to the file (`notes.designApplied`), the share's linearised standard error (`seExact`)
  and the design's degrees of freedom (PSUs minus strata).
- **Independent samples, no design on either side:** the two-proportion z-test with the share pooled under the null
  hypothesis, on the effective bases (`_pooled_prop_se`, the column test's), two-sided normal p (`_p_two_sided`).
  Weighting is allowed for through the effective base; the test assumes simple random sampling within each wave with
  the design effect from the weights only.
- **A survey design in both waves:** the difference's standard error is sqrt(se1^2 + se2^2), each the engine's
  design-based standard error, with a Student t reference on the summed design degrees of freedom
  (`_p_two_sided_t`, as `_p_two_sided_design` does for one design). A share of 0% or 100% has no design variance and
  is not tested (the column test's rule).
- **A design in one wave only:** not tested, with the reason.
- **Bases:** not tested when either wave's unweighted base is under 30 (`MIN_BASE_RELIABLE`) or effective base under
  30 (`MIN_EFFECTIVE_BASE`), the column test's rules.
- **Level and multiplicity:** two-sided, p < 0.05 (`SIG_LEVEL`), not adjusted for multiple comparisons. Each page
  says so in one line: "Change marked when a two-sample test on effective bases gives p < 0.05; not adjusted for
  multiple comparisons." Why no adjustment: a tracker reader reads named figures (a brand's stage, an attribute), not
  a family chosen after the fact; an adjustment across a page's hundred cells would change with the number of
  brands shown. With about 20 tests in view, about one flag is expected by chance when nothing changed; the line
  says the marks are unadjusted so they are read that way.
- **States:** tested (z, p, significant, direction), untested with the reason (base rules, design rules, an
  effective base not known from an older engine, a design applied without a design-based variance for that figure,
  a page's small-base rule), or failed (the engine request failed) with the reason. An untested or failed change is
  never shown as "not significant".
- **On screen** (`ChangeBadge.tsx`): a significant change is an arrow (up or down) and bold, with its words for
  assistive technology ("+8.3 points against Wave 2, significant at 95% (p = 0.001)"); a change not tested has an
  asterisk and its reason in the tooltip and spoken words. Never colour alone.

References: `scripts/crosstab_selftest.py` "R5 waves" checks (hand-computed pooled z and p for 200/500 against 276/600,
z 1.9999, p 0.0455, equal to statsmodels `proportions_ztest`; Kish effective base below n from the weights and the z on
it; rescaling every weight changes no share, effective base, z or p; base, missing-share, one-sided-design and 0%
states; a one-stage cluster design's Taylor standard error by hand and the t test on the summed degrees of freedom
against scipy). `src/lib/__tests__/trackerWaveChange.db.test.ts` against `helpers/wave_change_reference.py` (pandas,
numpy and scipy over the three waves, written from this contract).

## Not in this change

Means (CSM satisfaction, brand repertoire) are shown with their change and no test. A design-based test of word of
mouth groups. A multiple-comparison adjustment. Saving the wave or comparison chosen (they are screen state, like the
Compare brands). The Moment profile view (another session).
