# CSM dashboard extension: journey, emotions, preference, reasons, competitive and noncustomers (R6)

Owner of the rules: `src/lib/csmExtension.ts` and the modules it names. Specification: the CSM packs of 30 October
2026: the separate pack (`fixtures/packs-2026-10-30/csm`, updated to Grant's second version of 15:20: six emotions,
call-centre and IVR diagnostics, pooled All_Waves files) and the combined pack (`fixtures/packs-2026-10-30/csm-combined`:
company and channel answers on one customer row). Each sector's brief, questionnaires, dashboard guide and
03 implementation instructions, and the combined import guide. Handover:
`claude/batchR6csmext-handover-2026-10-30.md`.

The added sections sit in the CSM dashboard's own section navigation after Company, Channels, NPS & loyalty and
Drivers: **Journey**, **Emotions and preference**, **Competitive and noncustomers** (`CsmExtensionSections.tsx`). They
use the dashboard's company scope as their company filter, its weighting choice, its cards, font and #2563eb accent.
Figures are computed on request and never saved, like every tracker dashboard page.

## Import keys and grains (`csmExtensionKeys.ts`, `csmExtensionRoles.ts`)

- **Files.** Each workbook is its own data file, imported with the first data sheet (Respondents, Experiences,
  Noncustomers) and its embedded Codebook, Labels and MR sets, as the import already reads them. The optional
  test-reference JSON and CSV and `CSM_Reference_Metrics.xlsx` are never imported or required.
- **Wave.** A wave's files are linked only by the wave label set under Import data (case and spacing ignored). The
  data's own `wave` column, when present, must hold one value and the same value in each linked file. Two files of one
  grain with the same label: that grain is not used, with the reason.
- **Grain** (`csmGrainOf`): structure decides, the data sheet's name must agree. Channel: `experience_id` and
  `channel`. Noncustomer: `current_focal_use` and `focal_company`. Relationship: neither, with `respondent_id`. No
  `respondent_id`, both markers, or a sheet naming another family: unknown, with the reason.
- **sample_type** is derived from the grain, never read from a column: Relationship and Channel are Current
  customers, Noncustomer is Focal noncustomers.
- **Keys** (`checkKeys`, `checkChannelLink`): customer = project (study) + company list (sector) + wave label +
  `respondent_id` as text (leading zeroes kept; a number is refused); channel record = customer key + `experience_id`,
  channel a dimension; one latest row per customer and channel; every channel record's customer exists in the same
  wave's Relationship file with the same weight; noncustomer IDs never equal a customer ID; the company lists of linked
  files name the same company by each shared code (`codeNamesDiffer`). A failed key check makes that file unused,
  with the reason; a failed link makes the Channel and Noncustomer files unused. Nothing is repaired or joined by row
  position, and the three grains are never unioned.
- **Existing views.** `trackerOverview.loadBrandOverview` compares a wave only with earlier waves of the same grain
  (`wavesOfSameGrain`), so a Relationship file's previous wave and trend are Relationship files, never the same
  project's Channel or Noncustomer file. A brand tracker (no CSM grain markers) keeps all its waves.

- **Combined files** (the combined pack): one customer row per wave with channel blocks `ch01_` to `ch04_` (the block's
  channel code). The grain is Relationship (one customer per row); the blocks are its channel experiences. Keys add:
  a used block carries its own channel code and an experience_id, an unused block is blank, a block is used exactly
  when `channel_used_c0k` is 1, experience IDs are unique. A combined file and a separate Channel file labelled with the
  same wave are the same customers in two representations: refused together (link problem), never pooled.
- **Pooled All_Waves files** (both packs): the wave column holds several waves; linked customer files must hold the same
  ones. Keys are wave + respondent_id. Figures are read for one wave (a Data wave choice, default the latest the data
  hold); every population adds the wave by raw code. A wave not in the data is refused.
- **Existing recognition on combined files**: the channel blocks are never a brand list (by answer lists or by names)
  and never a company CSM role (`trackerRoles.recogniseTracker`), so the Company tiles read the company questions.

## Fields (`csmExtensionRoles.ts`)

Found by the pack's codebook names and confirmed by their answer lists (`fieldOf`): a 1 to 5 scale must declare 1 to
5, an outcome its pending code 9, a 0/1 answer 0 and 1, a count must be numeric. A missing name or a list that does
not fit is **Not measured** with the reason, per figure. Recognising the same constructs from wording in files that
use other names is not done (open question).

## Metric definitions (`csmExtensionMetrics.ts`)

Every figure comes from `computeCrosstab` (excludeDk false, so every code returns with its unrounded weighted count
and unweighted count) through `readStatistic`, `readDistribution` or `readCountMean`. Populations are engine filters
on raw codes (`between` with one value, never a label). The base is the weighted count of answers inside the
statistic's domain; labelled non-answers (99, 98) are excluded and counted (`nonresponse`); other codes outside the
domain are excluded and counted (`outsideDomain`); blanks are structural skips.

| Statistic | Definition | Unit |
|---|---|---|
| t2b | 4 and 5 among valid 1 to 5 (on an agreement item: Agree or Strongly agree, never "satisfied") | percent |
| top, b2b, dist1 to dist5 | 5; 1 and 2; each code, among valid 1 to 5 | percent |
| mean5, mean7 | mean of valid 1 to 5, 1 to 7 | scale points |
| ease | 6 and 7 among valid 1 to 7 | percent |
| nps | 9 and 10 minus 0 to 6 among valid 0 to 10 (passives in the base) | score |
| risk | 8 to 10 among valid 0 to 10 | percent |
| yes | 1 among valid 0 and 1 (a 0 is an answer) | percent |
| mean_gap | mean of valid -4 to 4 | scale points |

Low bases (`smallBaseLevel`, the pack's declared rule): raw valid n below 50 flagged, below 30 descriptive only; the
engine withholds cells below 10. Weighting: current customers use the dashboard's choice with each file's weight
(channel records inherit their customer's weight); noncustomers are unit weight (unweighted, raw = weighted base).
Rescaling the weights changes no share or mean (tested).

## Journey continuity (`csmJourney.ts`)

Population: Relationship rows with `journey_recent30 = 1`, plus the company scope, task (`journey_task`) and a
journey channel used (`journey_channel_cXX = 1`), all by raw code (`journeyPopulation`, shared by every section).
One customer counts once. Shown: recent task share (all customers), completion among known outcomes
(`journey_completed`), pending share beside it (status 9 among valid outcomes), the outcome distribution with pending
as an answer, journey CSAT (top two, mean, distribution), mean contacts, multi-channel share, each channel used,
digital mode (app, website, both; "digital self service" is never called app), transferred, repeated information,
ordered paths (`journey_sequence` as written, read from the file's table with the same weight, top ten) and distinct
channels per path, with disagreement against the channel flags counted. Never: joining the Channel file's latest
records into a path, or averaging channel CSAT into journey CSAT. Company CSAT among recent customers is shown beside
the all-customers figure, labelled as a different population.

## Customer benchmark (`csmJourney.loadBenchmark`)

Eligible: `benchmark_recent_same_task30 = 1`, `benchmark_days_ago` 0 to 30, both ratings valid (the derived
`benchmark_gap5` is present only then), alternative task equal to the journey task, alternative provider not the main
provider. The last two are row-wise; they are checked on every recorded comparison (task against journey task, and
provider against company, by code) and any breach makes the figure Not measured with the count. The figure is the
weighted mean of the within-person gap in scale points (positive favours the main provider). Shown with the eligible
raw and weighted base, the recent tasks asked, those with a comparable task, those without, and comparable but not
eligible. A channel comparison additionally needs a single-channel journey (`journey_multichannel = 0`) in the
benchmark's channel. Descriptive only; no causal, ROI, churn or ranking claim.

## Emotions, preference and reasons for staying (`csmExperience.ts`)

Six emotions (reassured, valued, frustrated, anxious, angry, disappointed; a first-pack file has four and the other two
are Not measured) at the journey grain (recent tasks, one customer once) and the channel grain (a Channel file, or a
combined file's channel blocks: per channel the block's users, all channels the blocks pooled code by code; latest
experience per customer per channel; records and distinct customers shown), each emotion its own figure on its own
valid base (mean, very or extremely, and the five intensity labels); never inverted or combined; very or extremely
angry, disappointed, frustrated or anxious is a negative outcome. Verbatims are the file's own text beside
the record's own ratings. Preference (agreement): experiences in three months (customer), the whole task (journey),
this channel experience (channel record), each labelled by recall and grain. Reasons for staying: each reason's share
of all current customers (multiple response, need not add to 100), None and Do not know, the primary reason
distribution (97 and 99 as answers), and, among those citing genuine preference, the share also citing each
constraint. Never called loyalty.

## Noncustomer profile (`csmNoncustomer.ts`)

The Noncustomer file only, with `current_focal_use = 0` and the file's one `focal_company` code enforced by filter
(records outside counted). Unit weight. Awareness (1 among valid 0 and 1), consideration among the aware (top two),
expected future performance on the six aspects among the aware (mean), importance (mean), preferred channel, and the
alternative provider's satisfaction only for a personally experienced task in 30 days with task and channel given.
Never: focal CSAT, NPS, experienced performance or emotions for noncustomers. Current customers' performance of the
focal provider on the same six aspects is a separate column, labelled as another population and period; no gap,
change or ranking is computed, and nothing is pooled.

## Not in these sections

The call-centre and IVR diagnostics of the second pack (live agent screen, queue wait, total call time and agent
satisfaction, first-transfer, ownership, promises with 9 not yet due, patience, urgency, IVR performance) belong to
the Channels view, which this branch does not build. Their published references are reproduced through the same
statistic reading (tests), so the readings are ready for that view.

## Export (`csmExtensionExport.ts`)

"Download figures (CSV)" on every section: one row per figure with section, grain, sample_type, wave, company, task
and channel filters, population, statistic, value, unit, raw and weighted base, non-answers excluded, low-base flag,
status (ok, Not measured, Failed) with the reason, definition, source file and a data note ("Synthetic demonstration
data (CSM pack)" for files named as the pack names them).

## Inputs and failures

Unknown is never 0: a missing field, an empty population (the engine refuses a filter nobody meets) or a link
failure is Not measured with the reason; any other error is Failed with the message; a whole-section failure shows the
error with Try again. Codes sent by the screen are checked at the server boundary (`parseExtensionRequest`) and
against the file's answer lists (`journeyPopulation`).

## Screens

Each request carries a sequence number; only the newest answer is shown, so a late answer for an earlier section,
filter or file never replaces a newer one. While a new answer is computed the previous figures of the same section
stay, dimmed, marked "Updating". Filters belong to one file; another file starts with none.

## Tests

`csmExtensionReference.db.test.ts` (every published reference value of the separate pack, both sectors, all waves,
actual loaders, real engine and database), `csmExtensionCombined.db.test.ts` (every Reference_Metrics.csv row of the
combined pack, the sections on the combined file, the pooled file by wave, both representations refused together,
the Company tiles), `csmExtensionRecognition.test.ts` (the recogniser on both packs' workbooks), `csmExtensionBehaviour.db.test.ts` (independent pandas values for figures without a published
reference, keys and grains, sample separation, the earlier CSM fixtures Not measured with existing figures unchanged,
weight rescaling, failure cases), `csmExtensionKeys.test.ts` (pure rules), `csmExtensionSections.test.tsx`
(mounted screens), `e2e/ui/tracker-csm-extension.check.mjs` (browser, production build, screenshots under
`docs/screenshots/r6csmext/`).
