# R5 audience: Audience and Media pages (worktree b121, branch r5audience, base b3e230f)

Status: implemented, ready for independent review.

Grant, 30 October 2026, on page 05 "Audience & media": "this view only shows age, there are other demos in the data
(gender Gender, province Province, settlement Settlement, income Monthly household income before tax, life_stage
Household life stage). Should we not include age, gender, income automatically and then have an option to add more?"
Then, through the coordinator: split the page into "Audience" and "Media" in the section list, and give Media view
controls (Compare to, Sort, Show) and a headline naming only differences that pass the engine's proportion test.

Tier A (recognition, saved choices, calculations, engine column identity) with a tier B screen.

## What changed for the researcher

- The brand dashboard's sections are now 05 Audience, 06 Media, 07 Category overview (formerly 05 Audience & media,
  06 Category overview). The page shown is held only while the dashboard is open (never stored), so no saved index can
  open the wrong page after the split.
- **Audience** shows a responsive grid of compact profile cards (one per row on a narrow screen, two from 1024 px, three
  from 1280 px): age, gender and household income by default, each the share of each answer for the client's brand's
  recent acquirers against all eligible category respondents, both bases on the card, every answer in the file's code
  order (income bands are never sorted by share), long labels cut with the full text on hover. A default the file does
  not have says so in a compact card with "Choose a question". "+ Add a profile question" lists the other single-choice
  questions asked once (province, settlement, life stage, ...) by wording with the variable name; each card has up and
  down arrows and Hide. The set is saved for the programme; "Saved for this programme." appears only after the server
  saves it; controls are disabled while saving; a concurrent change elsewhere gives the existing conflict message and
  reloads.
- **Media** keeps the media use card (two-series bars, now in two columns) with: Compare to (all eligible category
  respondents, the default, or any other brand's recent acquirers from the acquisition question, with that group's
  base and small-base banner); Sort (by the client's brand's share, the default, or by the difference); Show (shares,
  the default, or index = focal share / comparison share x 100, withheld below a base of 50 or at a 0% comparison).
  A one-line headline names where the client's acquirers are clearly higher or lower (at most three each way), only
  for differences the engine's test passes; "No clear differences ..." when the test ran and none passed; no headline
  below a base of 50 (the page says "No test: a group has fewer than 50 respondents."). Media rows tested higher or
  lower carry a small up or down marker.

## Impact checklist (AGENTS.md)

1. **Rule.** Registry rows "A tracker dashboard's Audience and Media pages" (updated) and "The Audience page's saved
   profile list" (new) in `claude/rules-registry.md`; contract `claude/d2-design-2026-10-29.md`, "D3f R5"; recognition
   `claude/tracker-roles.md` rule 5b1. Owners used, no second version: recognition in `trackerRoles.ts` (the existing
   `singleChoiceWording`, `oneQuestion`, asked-once set; non-answers by `nonAnswerLabel.isNonAnswerLabel`); every
   profile card by the age card's method (`ageRowsFromResults` renamed `profileRowsFromResults`, one function); shares
   by `trackerFigures.answersOf` / `selectedShareOf` / `selectedAnswerOf` / `selectedCode`; tables by
   `computeCrosstab`; the saved choice through `saveTrackerChoices`; the test is the engine's own column test (no
   TypeScript statistic).
2. **Inputs.** A default not found: "not_found" card with the recogniser's reason and "Choose a question"; two
   candidates: "ambiguous" with the reason; a saved variable a wave lacks: "not_in_file", shown and kept; no acquisition
   question, no client's brand, nobody acquired: as D3f (Not measured, Mapping needed, acquirer figures n/a never 0); a
   comparison brand code not in the brand list (or the client's own): the comparison card says so and the focal figures
   still show; a suppressed share is n/a with the reason; an unknown share never becomes 0 (index n/a, headline skips
   it, sort puts it last). A set banner the engine cannot resolve: no test, with the engine's reason. A failed read
   throws to the page's "Try again".
3. **Persistence.** No new table or column: `audienceProfiles` is a key of the existing `tracker_dashboards.choices`
   JSON, so no migration (0136 not written). Saved by `saveTrackerChoices`: one transaction, project row locked, file
   checked in the project, compare-and-swap on scope and revision (a stale save gets `conflict` with the current
   choices and writes nothing), choices checked on the server (`profileChoiceProblems`), normalised on read and write.
   The screen saves from the stored choices, never an unapplied Customise draft. A retry with the same revision after
   success is a conflict (no duplicate); a failed save writes nothing. Before migration 0132 the page shows the
   defaults and says profile questions cannot be saved.
4. **Freshness.** Figures are computed on opening, nothing saved, so no finding, insight, recommendation, narrative or
   export depends on them; nothing to mark stale. The saved list is a human choice and survives reloads, other waves
   (kept when a wave lacks a question) and resaves of other choices; Reset to suggested clears it with the rest
   (previous choices kept, as before). `TRACKER_ROLE_RULES` raised to `d1-2026-10-30` (recorded with saved choices).
5. **Screens.** Each page loads its own figures when shown and again when the dashboard reloads (`loadKey`); only the
   latest request may update a page (an earlier answer for another comparison or file is ignored; mounted test);
   "Saved" only after the server confirms (the panel's existing save path); cards and their controls come from the
   same read as the saved list, figures are joined by variable name.
6. **Proof.** Below.

## Recognition rules (trackerRoles.ts)

- Gender (`findGender`): a single-choice question asked once; its own wording names gender or sex, or asks "male or
  female" or "man or woman", or how the respondent identifies; at least two answers, and 60% of the answers other than
  non-answers, name a gender (male, female, man, woman, non-binary, another or other gender or identity,
  self-describe, ...). BMW: "Gender" (Man, Woman, Another identity, Prefer not to say).
- Income (`findIncome`): a single-choice question asked once; its own wording names income, earnings, earn, salary or
  wages; at least two answers, and 60% of the non-non-answers, are amount bands (a number with a currency: R, $, GBP,
  ZAR, rand, ...; or a number with a range or bound: "15 000 to 29 999", "Under 5,000", "80 000+", "or more"; "No
  income" counts). BMW: "Monthly household income before tax".
- Profile questions (`profileQuestionsOf`): every single-choice question asked once with an answer list and its own
  wording, in file order, except the wave marker ("Wave"). Asked once already leaves out brand list questions,
  per-brand (funnel) questions and grid cells; a yes/no option (media, journey) is never single choice here.
- Never by a variable name alone; two candidates are ambiguous; asked once as before.

## Saved-choice contract

`TrackerChoices.audienceProfiles?: { role: "age" | "gender" | "income" | null; variable: string | null; label: string |
null }[]`: role with variable null = the recognised default in each wave; role with variable = the researcher's
question in that default's place; role null = an added question; a missing role = a hidden default; list order = card
order; absent = the defaults. Identity is the raw variable name; `label` is the wording snapshot. Server checks: at most
24; no role or variable twice; a default's recognised question not added again; a new variable must be one of this
file's profile questions; one unchanged from the stored list is kept even if this wave lacks it. Resolution per wave:
`resolveProfiles` (ok, not_found, ambiguous, not_in_file).

## Figures and test

As the D3f R5 contract. Media test: the engine's two-proportion test at 5% per medium, `correction: "none"`. Against
all eligible: focal acquirers against the eligible respondents who are not acquirers (the engine never tests a group
against a total that contains it; the bar shown is all eligible). Against another brand: the acquisition question as a
multiple-response set banner, the two brands' columns compared by the engine's column-pair test (a respondent who
acquired both counts in both). Engine change: set-banner member columns now carry `var` (their variable) so the two
brands' columns are found by identity, never by cleaned label (`api/parse-stats-file.py`, one line;
`parseStatsFile.ts` comment).

## Files

- `src/lib/trackerRoles.ts`: `findGender`, `findIncome`, `profileQuestionsOf`, `ProfileQuestion`; recognition fields
  `gender`, `income`, `profileQuestions`.
- `src/lib/trackerDashboard.ts`: `ProfileChoice`, `ResolvedProfile`, `PROFILE_DEFAULTS`, `DEFAULT_PROFILES`,
  `PROFILE_ROLE_TEXT`, `MAX_PROFILE_QUESTIONS`, `resolveProfiles`, `profileChoiceProblems`, normalising;
  `ResolvedDashboard.audienceProfiles`, `audienceProfilesSource`; `TRACKER_ROLE_RULES` d1-2026-10-30.
- `src/lib/trackerAudience.ts`: `loadBrandAudience` (profiles), `loadBrandMedia` (new), `profileRowsFromResults`
  (renamed from `ageRowsFromResults`), `mediaRowsFromResults` (focal and comparison, list order), `mediaTests`,
  `setKeyOf`, shared `pageContext`, `acquirerGroupOf`.
- `src/lib/trackerAudienceFigures.ts` (new, pure, screen-safe): `smallBaseLevel` (moved, re-exported), `mediaIndex`,
  `sortMediaRows`, `mediaHeadline`, row types.
- `src/lib/trackerDashboardActions.ts`: `loadBrandMediaAction` (compare code checked at the boundary).
- `api/parse-stats-file.py`, `src/lib/parseStatsFile.ts`: set member column `var`.
- `src/app/runs/[id]/AudienceProfiles.tsx` (new): `AudiencePage`, `MediaPage`.
- `src/app/runs/[id]/TrackerDashboardPanel.tsx` (minimal, page 05 only): `BRAND_SECTIONS` split, the page-05 load
  state and effect removed (the pages load their own), `audienceView` and `mediaView` render the new components, the
  Category overview's index 5 to 6.
- Tests: `trackerAudienceProfiles.test.ts`, `trackerAudienceProfiles.db.test.ts`, `audienceProfilesPanel.test.tsx`,
  `helpers/profile_reference.py` (new); `trackerAudience.test.ts`, `trackerAudience.db.test.ts`,
  `trackerDashboards.db.test.ts` (rules version) updated; `e2e/ui/tracker-audience-profiles.check.mjs` (new),
  `e2e/ui/tracker-audience.check.mjs` (navigation: the menu buttons are now "05 Audience" and "06 Media"; the age card is
  one of the profile cards; media rows are in the default order, by the BMW acquirers' share; value test ids are
  `-focal` and `-comparison`).
- Docs: `claude/d2-design-2026-10-29.md` (D3f R5), `claude/tracker-roles.md` (5b1), `claude/rules-registry.md`.

Callers and consumers checked: `trackerDashboardActions` (both actions), `TrackerDashboardPanel` (only page 05/06/07
wiring), `trackerDashboards.loadTrackerDashboard` and `saveTrackerChoices` (unchanged; resolve and check through
`trackerDashboard.ts`), every reader of crosstab columns' `var` (CrosstabWorkspace `data-col-var`, trackerAdvertising's
single-variable banner: unaffected).

GATES_PLACEHOLDER
