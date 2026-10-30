# Batch R6 csmext handover: CSM dashboard extension (30 October 2026)

Status: **implemented, ready for independent review**. Not merged, not deployed; no live database or Supabase
project touched; no migration (figures are computed on request and nothing new is stored).

Branch `claude/r6csmext` (pushed only there; no pull request). Base `2313eec` (r6csmext work so far). Approved by
Grant. Contract: `claude/csm-extension.md`. Registry: two new rows in `claude/rules-registry.md`.

## Specification read

- First separate pack (`fixtures/packs-2026-10-30/csm` at `2313eec`): both Claude instruction documents in full,
  START_HERE, QA_REPORT, CHANGELOG, each sector's brief, Company, Channel and Noncustomer questionnaires, 02 guide,
  03 instructions, codebooks, workbooks, test-reference.
- Grant's updated files of 15:20 (coordinator, 30 October): the separate pack's second version and the new combined
  pack. Both read in full (START_HERE, README, QA reports, CHANGELOG, briefs, questionnaires, guides, 03
  instructions, the combined import guide).

### What changed in the separate pack (v1 to v2), now in `fixtures/packs-2026-10-30/csm`

- New fields: `journey_angry5`, `journey_disappointed5` (J7f, J7g); `channel_angry5`, `channel_disappointed5` (E8f,
  E8g); 15 call-centre diagnostics on channel 1 (Q7a to Q9d: live-agent screen, queue-wait, total-call-time and agent
  satisfaction, correct person at first transfer, ownership, promises kept with 9 not yet due, patience, urgency, IVR
  availability, response speed, information accuracy and ease). Company schema 98 to 100 fields, channel 71 to 88.
  Original values unchanged (the pack's preservation report and validator).
- New files: `<Sector>_CSM_Relationship_All_Waves.xlsx` and `_Channel_All_Waves.xlsx` (exact concatenations),
  label and MR-set CSVs, `Reference_Metrics.csv`, `Source_to_Combined_Map.csv`, `validate_separate_pack.py`,
  `quality_checks/`, `README.txt`. Removed: the two top-level `*_CSM_Claude_Instructions.docx` (the sector 03
  documents carry the instructions).
- Changed: every data workbook and CSV (added columns), the reference results (banking 2,202 to 3,306, mobile 1,941
  to 2,907), the reference workbook (sheets Reference metrics, Definitions, Source reconciliation, Read me; the
  "Focal company overview" sheet is gone), briefs, questionnaires, guides, 03 instructions, codebooks, manifests.
- Instruction changes that affect this work: six emotions shown separately (angry and disappointed high intensity
  is negative); import either the three wave files or All_Waves, never both, default to one wave; choose separate or
  combined representation, never both; join on (wave, respondent_id) and verify 13 shared fields.

### The combined pack, now in `fixtures/packs-2026-10-30/csm-combined`

One customer row per wave: 100 company and journey fields and four 75-field channel blocks `ch01_` to `ch04_`
(unused block blank). Wave files of 1,000 rows and an All_Waves file of 3,000; optional noncustomers in
`supplemental_noncustomers/`; `reference/Reference_Metrics.csv` (banking 3,306, mobile 2,907 rows). The loose files
Grant sent beside it (`files/`) are byte-identical copies of files in the pack and are not added twice.
Codex's independent values: `fixtures/packs-2026-10-30/csm-combined-codex-reference` (unedited).

## What it does

Three new entries in the CSM dashboard's section navigation after Company, Channels, NPS & loyalty and Drivers
(`CSM_EXTENSION_TABS`, `CsmExtensionSections.tsx`):

- **Journey**: from the customer record's anchored task (journey_recent30 = 1): recent task share, completion among
  known outcomes with the pending share beside it, outcome distribution with pending, journey CSAT (top two, mean,
  distribution), contacts, multi-channel, channels used, digital mode (app, website, both), transfers, repeated
  information, ordered paths and distinct channels from journey_sequence, and company CSAT among recent customers
  beside the all-customers figure, labelled as another population. Filters: the dashboard's company scope, task,
  channel used, and a Data wave for pooled files, all by raw code.
- **Emotions and preference**: six emotions separately (mean, very or extremely, five intensities, own bases) at the
  journey grain and the channel grain (a Channel file, or the combined file's blocks per channel and pooled; records
  and distinct customers); preference at three grains by recall; reasons for staying (multiple response, None, Do not
  know, primary reason, preference with each constraint); the files' own verbatims.
- **Competitive and noncustomers** with a **Sample** selector: the customer benchmark (eligible paired gap in scale
  points, bases, comparable and noncomparable counts, by channel) or the focal-noncustomer profile (enforced sample,
  unit weight, awareness, consideration among the aware, expectations and importance, preferred channel, alternative
  satisfaction for a personal recent task), current customers' performance as a separate column, no gap.
- Every section: the wave's files with grain, sample type, sheet, records and distinct people; link problems in an
  alert; "Download figures (CSV)" with grain, sample_type, wave, data wave, filters, definition, raw and weighted
  base, non-answers, low-base flag, status, source file and a synthetic-data note.

Changes to existing behaviour (each tested):

1. `trackerRoles.recogniseTracker`: the extension's fields are never read by the recogniser (first run of the
   reference test: "No overall satisfaction question was found" on the expanded workbook, and a brand frame taken
   from the benchmark's lists, so no split by company); a combined file's channel blocks are never a brand list (by
   answer list or by names) or a company CSM role (the combined file showed a brand list "Payment or transfer ..."
   and no drivers); a Channel or Noncustomer file gives no company CSM role (the second-version Channel file's
   "Overall satisfaction with the live agent" was taken as company satisfaction: behaviour test failure before the
   fix).
2. `trackerOverview.loadBrandOverview`: the previous wave and trend come from files of the open file's grain.

## Impact checklist

1. **Rule.** New owners with registry rows and a contract: grain, sample type, keys and wave linking
   (`csmExtensionRoles.ts`, `csmExtensionKeys.ts`); figures (`csmExtensionMetrics.ts`, `csmJourney.ts`,
   `csmExperience.ts`, `csmNoncustomer.ts`, `csmExtension.ts`, `csmExtensionExport.ts`). Owners reused:
   `computeCrosstab`, `parseTable.parseTableDocument`, `loadRoleInput`, `loadTrackerDashboard`,
   `trackerFigures.codeNamesDiffer`, `trackerAudience.smallBaseLevel`, `nonAnswerLabel.isNonAnswerLabel`. Engine
   unchanged: populations use its `between` filter on raw numeric codes.
2. **Inputs.** Missing field, wrong answer list, empty population, absent file, ambiguous or conflicting files, failed
   keys or links: Not measured with the reason per figure; other errors Failed with the message; whole-section errors
   with Try again. 99 and 98 excluded and counted; pending kept as an answer; a 0 is an answer. An SPSS file: keys
   unchecked and said, never linked. A data wave not in the file is refused.
3. **Persistence.** None.
4. **Freshness.** No stored derived result changes meaning; exports are built from the figures shown. Existing CSM
   tiles on files with the new fields change from missing or wrong to the correct figure; the earlier CSM fixtures'
   figures are unchanged (tested).
5. **Screens.** Request sequence: a late answer never replaces a newer one (mounted test); while updating, the
   previous figures of the same section stay dimmed with "Updating"; filters belong to one file.
6. **Proof.** Below.

## Import keys and grains

| Grain | Data sheet | Key | sample_type | Weight |
|---|---|---|---|---|
| Relationship | Respondents | project + company list + wave label + (wave, respondent_id as text) | Current customers | file weight (dashboard choice) |
| Channel | Experiences | customer key + experience_id; one per customer and channel | Current customers | the customer's weight |
| Combined (Relationship grain with blocks) | Respondents | customer key; each used block its own code and experience_id; block used exactly when channel_used_c0k = 1 | Current customers | the customer's weight once per used channel |
| Noncustomer | Noncustomers | own NC IDs, never a customer ID | Focal noncustomers | 1 |

Pooled All_Waves files: several wave values; linked customer files must hold the same; figures read one wave at a
time (default the latest). A combined file and a separate Channel file with the same wave label are refused together.

## Reference reproduction (actual loaders, real engine, disposable database)

Tolerance 0.000001 on unrounded values, numerators and weighted bases; raw bases exact.

| Source | Banking | Mobile | Through |
|---|---|---|---|
| Separate v2 reference_results.json, every row (by company and channel, incl. the call and IVR diagnostics) | 3,306 / 3,306 | 2,907 / 2,907 | `tabulate` + `readStatistic` |
| Separate v2 CSM_Reference_Metrics.xlsx rows equal to the JSON | 3,306 | 2,907 | openpyxl |
| Separate v2 added metrics through the sections' loaders (58 per wave: journey 6, six journey emotions, angry and disappointed high, preference 3, channel emotions, angry and disappointed by channel, staying reasons 6, benchmark, noncustomer 14) | 174 | 174 | `loadCsmExtension` |
| Separate v2 existing CSM tiles by company, waves 1 to 3 | 75 | 66 | `loadBrandOverview` |
| Combined Reference_Metrics.csv, every row (company, each block, pooled blocks, noncustomers) | 3,306 / 3,306 | 2,907 / 2,907 | `tabulate` + `readStatistic` |
| Combined, the sections' loaders on the combined file, waves 1 to 3 | 138 | 138 | `loadCsmExtension` |
| Combined All_Waves read by wave (default latest; wave 2 on request; unknown wave refused) | passed | passed | `loadCsmExtension` |
| Codex independent values, every row weighted and unweighted (mean, distribution, top two, top box, bottom two, NPS and its parts, risk, valid and eligible raw bases exact, weighted base) | 6,208 comparisons | 5,432 comparisons | `tabulate` + `readStatistic` |
| Codex, existing CSM tiles by company (satisfaction top two and mean, stay, switch, NPS and its raw base) | see below | see below | `loadBrandOverview` |

**Codex row-by-row disagreements.** Statistic reading: none. Tiles: satisfaction, stay and switch by company agree
within 1e-6 and NPS raw bases exactly; the **NPS tile** value differs in 45 rows because the NPS tool
(`npsActions.computeNps`, existing, "rounds only its results") returns the score rounded once to one decimal. Every
one of the 45 equals Codex's value rounded to one decimal (largest difference 0.049, inside the pack's 0.05 display
tolerance); the unrounded NPS agrees at 1e-6 through the reading. The reference was not changed. The test now checks
these tiles against the rounded value and prints every row. The rows: banking waves 1 to 3, all customers and
companies 1 to 7 (24 rows); mobile waves 1 to 3, all customers and companies 1 to 6 (21 rows); for example banking
wave 1 all customers app 2.6 vs Codex 2.6114372730277573, mobile wave 2 company 4 app -19.1 vs Codex
-19.092545283378016 (the full list is in the test's log line "R6 Codex NPS tiles shown to one decimal").

**Codex rows not covered as displayed figures:** channel satisfaction (`ch0k_channel_csat5`) and `price_switch5` are
reproduced through the reading but not shown on a screen (the Channels view is not built here; price switching has
no tile); pooled-across-waves rows are reproduced from the All_Waves file unfiltered, while the sections always show
one wave; Kish effective bases and the scope inventory are not compared.

**Pack validators** (run on copies, they write result files): `validate_separate_pack.py --xlsx` passed (26 XLSX,
3,088,780 cells, 6,213 references, 5,372,315 assertions; banking 3,000 customers and 4,837 experiences, mobile 3,000
and 4,576). `validate_combined_pack.py . --xlsx --source-separated <first separate pack>` passed (10,173,417
assertions, 6,363,324 XLSX cells, 1,358,323 source values; pooled files exact concatenations). Run against the second
separate pack instead it stops at "reference exact preservation", as designed (it checks against the unchanged first
version). The first-version `validate_pack.py` passed for both sectors (11,467 and 10,954 checks); in v2 that script
takes `--root` and is superseded by `validate_separate_pack.py`.

## Files

New: `src/lib/csmExtension.ts`, `csmExtensionActions.ts`, `csmExtensionExport.ts`, `csmExtensionKeys.ts`,
`csmExtensionMetrics.ts`, `csmExtensionRoles.ts`, `csmJourney.ts`, `csmExperience.ts`, `csmNoncustomer.ts`;
`src/app/runs/[id]/CsmExtensionSections.tsx`; tests `src/lib/__tests__/csmExtensionReference.db.test.ts`,
`csmExtensionBehaviour.db.test.ts`, `csmExtensionCombined.db.test.ts`, `csmExtensionCodexReference.db.test.ts`,
`csmExtensionKeys.test.ts`, `csmExtensionRecognition.test.ts`, `csmExtensionSections.test.tsx`, helpers
`csmPackDb.ts`, `csm_extension_reference.py`, `csm_modify.py`; `e2e/ui/tracker-csm-extension.check.mjs`;
`claude/csm-extension.md`; `docs/screenshots/r6csmext/`; fixtures `csm` (v2), `csm-combined`,
`csm-combined-codex-reference`.

Changed (grouped): `TrackerDashboardPanel.tsx` (tab entries, tab type, rendering, `flex-wrap`), `trackerOverview.ts`
(same-grain waves), `trackerRoles.ts` (extension fields, channel blocks, channel and noncustomer files),
`claude/rules-registry.md`, `claude/tracker-roles.md`.

Coordination: r5csmroles turns the tabs into a side menu; the three entries come from `CSM_EXTENSION_TABS`. Both
branches edit `recogniseTracker`'s inputs (`usable`, the `recogniseCsm` call): a small manual merge. r5csmseg's
segment: every population here starts in `journeyPopulation` and the channel and noncustomer filters, the place to add
it (not done).

## Commands and counts

Run in a cloud worktree of this branch (PostgreSQL 16 on 55432, trust auth; Python 3 with pandas, numpy, scipy,
pyreadstat, openpyxl; Playwright Chromium 1194), after `npx next typegen`:

- `NODE_OPTIONS=--max-old-space-size=3072 npx tsc --noEmit`: 0 errors.
- `NODE_OPTIONS=--max-old-space-size=4096 npx eslint src e2e --quiet`: 0 errors.
- `python3 scripts/crosstab_selftest.py`: All checks passed (engine unchanged).
- `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres npx vitest run src/lib/__tests__ --pool=forks --maxWorkers=3`:
  **Test Files 378 passed, 2 skipped (380); Tests 2,877 passed, 92 skipped (2,969)**; 3,169 s. The two skipped
  files are the existing real-model and limit-measurement files (`researchQualityModel.real.test.ts`,
  `indicatorLimitMeasure.db.test.ts`). The seven R6 files all passed: Reference 8, Behaviour 7, Combined 8, Codex 4,
  Keys 13, Recognition 5, Sections (mounted) 3.
- Production build: `NEXT_FONT_GOOGLE_MOCKED_RESPONSES=$PWD/scripts/e2e/font-mock.cjs NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:39461 ... npx next build --webpack` against a migrated disposable database; then
  `E2E_NEXT_START=<worktree> E2E_STORAGE_PORT=39461 E2E_APP_PORT=3461 E2E_ADMIN_DATABASE_URL=... node scripts/e2e/local-stack.mjs` and
  `SHOT_DIR=docs/screenshots/r6csmext npx playwright test -c e2e/ui/ui-check.config.mjs tracker-csm-extension tracker-dashboard --workers=1`:
  **5 passed** (CSM extension separate pack, CSM extension combined file, the BMW brand dashboard, CSM tiles, CSM by
  company). The first run had 3 failures: two in the new check (emotion rows 4 instead of 6 after the six-emotion
  change; a CSV line split that ignored quoted commas), fixed in the check; the BMW brand check failed once at the
  Import screen and passed unchanged on the rerun. The build output and its database were removed afterwards.
- Pack validators (copies): see Reference reproduction.
- Screenshots (1440 x 900): `docs/screenshots/r6csmext/01-company-unchanged.png`, `02-journey.png`,
  `03-journey-task-filter.png`, `04-emotions-preference.png`, `05-reasons-for-staying.png`,
  `06-competitive-customers.png`, `07-noncustomers.png`, `08-combined-company.png`, `09-combined-emotions.png`; the
  existing check also wrote `tracker-*.png` (1500 wide) there.

## Mocks versus real

Real: PostgreSQL 16 disposable databases, the Python engine through the local worker, the packs' XLSX imported as
data files, the app's loaders and recognition, a production build (`next build --webpack`) served by the disposable
stack in Chromium. Stood in: object storage (in-memory bytes), request context and Next cache in the library tests;
the server action in the mounted test; storage, auth and model replay in the browser stack. Independent values: the
packs' references, Codex's values, pandas from the pack CSVs.

## Limits

- Fields are found by the packs' codebook names confirmed by answer lists; other names show Not measured.
- The benchmark's task and provider rules are row-wise: a breach makes the figure Not measured with the count.
- Paths, verbatims, key checks and distinct customers need the table reader (CSV, TSV, Excel).
- A combined-and-separate conflict also withholds the noncustomer file of that wave (conservative).
- Each section reads the wave's files (about 10 s per uncached workbook read under load); no figure cache.
- The call-centre and IVR diagnostics are reproduced but not displayed (Channels view not built).
- Screenshots: the build used the documented font mock because Google Fonts is unreachable here, so the screenshots
  show the browser's fallback serif, not Geist. Layout, colours and the #2563eb accent are the app's.
- One browser run of the existing BMW brand check failed once at the Import screen ("Select bmw_w2.sav" not found)
  and passed on the rerun; not related to these changes, reported as flaky.

## Open questions for Grant

1. Apply the r5csmseg segment to these sections (one place: `journeyPopulation` and the channel and noncustomer
   filters)?
2. Recognition by wording for CSM files that do not use the packs' names?
3. Benchmark: keep Not measured when a recorded comparison breaks the task or provider rule, or exclude those rows
   (needs an engine filter comparing two columns)?
4. Show the call and IVR diagnostics and channel CSAT in the Channels view (r5csmroles) using `readStatistic`?
5. Should the NPS tile carry the unrounded score as the other tiles do (the NPS tool rounds once to one decimal)?
6. A pooled All_Waves file is read one wave at a time; is a labelled pooled estimate ever wanted on screen?
