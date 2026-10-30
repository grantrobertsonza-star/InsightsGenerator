# Tracker test packs: variable-role specification and reference values

Date: 28 October 2026. Status: research note, read-only analysis of the synthetic test packs on Grant's laptop (`C:\Personal\InsighsAI\TestProjects\`). Nothing on the laptop was modified. All brand and company results in these packs are synthetic fixtures, not market estimates.

Purpose: define what an automatic CSM dashboard and an automatic brand-tracking dashboard in Insights Elevator must recognise (variable roles, brand frames, bases, special codes), and which reference values the dashboards must reproduce, with the exact location of each value.

Conventions used below:

- "Codebook" means the per-variable table (Master_Codebook / Codebook sheet / `metadata.json` `variables` or `company_specs` / `channel_specs`).
- Numbers are quoted from `reference_results.json` (or `Reference_Metrics.xlsx` where stated) and rounded for display: brand funnel to 1 dp (the stored unweighted values are exact to 1 dp because the base is 1,000), other values to 2 or 4 dp. The JSON holds full precision. The packs declare a tolerance of 0.000001 pp for stored percentages and 0.05 pp for one-decimal displays.
- `bYY` = brand code suffix, `cXX` = situation (CEP) code, `aXX` = attribute code, `mXX` = medium, `jXX` = journey step, `pXX` = product, `dXX` = CSM driver aspect.

## 1. Pack inventory

| Pack | Folder (under `TestProjects/`) | Grain and size | Focal | Machine-readable metadata | Reference answer key |
|---|---|---|---|---|---|
| BMW car brand tracker | `Brand Tracker/CarTracker/BMW_Car_Brand_Tracker/` | 3 independent waves x 1,000 respondents, 494 variables | BMW (code 8) | `metadata.json` (pack root) | `reference_results.json` (pack root), 7,857 rows, `schema_version` "3" |
| SA banking brand tracker | `Brand Tracker/SA_Banking_Brand_Tracker_Pack/banks/` | 3 x 1,000, 501 variables | FNB (code 8) | `test-reference/metadata.json` | `test-reference/reference_results.json`, 8,661 rows, `schema_version` "1.0" |
| SA insurance brand tracker | `Brand Tracker/SA_Insurance_Brand_Tracker_Pack/insurers/` | 3 x 1,000, 501 variables | OUTsurance (code 8) | `test-reference/metadata.json` | `test-reference/reference_results.json`, 8,661 rows |
| Mobile telecoms brand tracker | `Brand Tracker/Telecoms_Tracker/telecoms/` | 3 x 1,000, 502 variables | Vodacom (code 8) | `test-reference/metadata.json` | `test-reference/reference_results.json`, 8,661 rows |
| Banking CSM | `CSM Tracker/Banking_and_Telecoms_CSM_Separated/banking/` | Relationship: 3 x 1,000 customers. Channel: most recent experience per customer per channel (W1 has 1,615 experience rows from 905 customers; mobile W1 1,498 rows from 880) | FNB (company code 1) | `test-reference/metadata.json` | `test-reference/reference_results.json` (top-level array, 2,088 rows) and `CSM_Reference_Metrics.xlsx` |
| Mobile CSM | `CSM Tracker/Banking_and_Telecoms_CSM_Separated/mobile/` | Same two grains | Vodacom (company code 1) | `test-reference/metadata.json` | `test-reference/reference_results.json` (1,827 rows) and `CSM_Reference_Metrics.xlsx` |
| Legacy coffee trackers | `Brand Tracker/Oldtracker/` | Older synthetic coffee files (1,200 or 500 rows) | Varies | None (in-workbook Codebook or Data Dictionary sheets only) | In-workbook "Metric checks" formulas only |
| Legacy CSM | `CSM Tracker/Old/` | 0-10 company and call-centre CSM | n/a | None | None |

Each wave workbook contains the case sheet (`Respondents` for brand and CSM Relationship files, `Experiences` for CSM Channel files) plus embedded `Codebook`, `Labels`, `MR sets` and `Read me` sheets. CSV copies carry no labels or typing. IDs are text with leading zeros (for example `01000001`) and must be read as strings.

## 2. How structure is described

### 2.1 Brand tracker packs (BMW, banking, insurance, telecoms)

Codebook columns (Master_Codebook `Variables` sheet, wave `Codebook` sheet, `metadata.json.variables[]`):

| Field | Meaning | Reliable for a generic recogniser? |
|---|---|---|
| `variable` | Column name | Identity only. Do not infer role from it. |
| `label` | Variable label, includes brand or option label (for example "Consideration Toyota") | Presentation only. |
| `question` | Questionnaire ID (`SYS`, `S1`..`S5`, `D1`..`D5`, `C1`, `A1`, `A1/A2`, `A3`, `M1`, `M2`, `F1`..`F3`, `O1`..`O7`, `O1/O3`, `R1`, `W1`, `AD1`, `AD2`, `I1`, `I2`, `P1`, `X1`..`X4`, `Derived`) | Yes for grouping and for linking to the questionnaire. IDs are local to the study, not a shared taxonomy. |
| `data_type` | `numeric` or `text` | Yes. |
| `question_type` | `text`, `categorical`, `continuous`, `multiple_response`, `scale` | Yes, but coarse: per-brand single-response grids (opinion, WOM, AD2) are `categorical`; NPS is `scale`. |
| `mr_set` | MR set ID (`unaided`, `aware`, `consider`, `shortlist`, `owner`/`current`, `bought12`/`started12`/`started90`, `ad_unaided`, `cep_c01`..`cep_c12`, `attr_a01`..`attr_a10`, `category_situations`, `media`, `purchase_journey`, `current_products`) | Yes. Exclusive None fields and Other flags are deliberately outside these sets. |
| `selected_value` | Counted value for MR members (always 1) | Yes. |
| `universe` | Base as a free-text expression: `All eligible respondents`, `aware_b08=1`, `bought12_b08=1`, `last_acquired=1`, `main_brand 1–10`, `Any current vehicle`, `category_active=1`, `experience_event=1`, `product_p01=1 or product_p03=1` | Partly. Simple `var=value` forms can be parsed; others need a small rule set or researcher confirmation. |
| `derivation` | Free text (for example "Sum of 12 cep_cXX_bYY indicators", "Derived indicator; see questionnaire route") | Identifies derived variables; not executable. |
| `unit` | `identifier`, `code`, `ISO date`, `relative weight`, `years`, `links`, `brands`, `0–10`, `top ups` | Yes for ID, weight, date detection. |
| `option_label` | Banking, insurance and telecoms only; repeats the label | Optional. Absent in BMW. |

Other registries:

| Registry | Where | Content |
|---|---|---|
| Value labels | `Value labels` / `Labels` sheet; `metadata.json.labels` as `[variable, variable_label, value, value_label]` arrays | Full code frames including 96/98/99/9 meanings. |
| MR sets | `MR sets` sheet: `set_id, variable, selected_value, option_label, universe` | Explicit membership. |
| Brands | Master_Codebook `Brands` sheet (`Raw code`, `Brand`); `metadata.json.brands` (ordered list, code = position 1..10) | 10 tracked brands. Non-brand codes (96 Other, 98 None / No first choice yet) appear only in value labels. |
| Situations (CEPs) | `Situations` sheet (`c01`..`c12`); `metadata.json.ceps` | 12 category entry points. |
| Attributes | `Attributes` sheet (`a01`..`a10`); `metadata.json.attributes` | 10 image attributes. |
| Media | `metadata.json.media` (12 items) | No separate sheet; MR set `media`. |
| Chart map | `Chart map` sheet: `Chart, Variables, Base, Definition`; `metadata.json.chart_map` | 16 chart families with base rules (prose). |
| Study header | `metadata.json` keys `sector, title, client, prefix, event_stem, category_scope, cautions` (not in BMW) | `client` names the focal brand; `event_stem` is `started12` or `started90`. BMW has no `client` field; focal brand is only stated in README, guide and chart-map text. |

What a generic app can rely on from codebook fields alone: question grouping, MR membership and counted value, numeric vs text, ID/weight/date by `unit`, brand registry and code frames from value labels, simple routed universes. What must be inferred from data, questionnaire or guide: funnel stage semantics (which MR set is awareness vs consideration), the focal brand in BMW, that `first_choice` 98 also covers "not asked", which code 9/99 values are nonresponse vs substantive, attribute-grid shape (brand x attribute from the `attr_aXX_bYY` pairing and the `aware_bYY=1` universe), DK handling inside attribute grids, and all metric formulas (top-box cuts, NPS, competitor average, CEP metrics). These are in the questionnaire and the analysis guide, not in machine fields.

### 2.2 CSM packs (banking, mobile)

Codebook columns (`Relationship_Codebook.csv`, `Channel_Codebook.csv`, Master_CSM_Codebook sheets `Relationship variables` / `Channel variables`, `metadata.json.company_specs` / `channel_specs`): `variable, label, question, data_type, question_type, universe, mr_set, selected_value, derivation, unit`. Note the column order differs from the brand packs (`universe` before `mr_set`). There is no `option_label` column; the MR sheets use `label`.

Other registries: `Relationship labels` / `Channel labels` (`company_labels` / `channel_labels` in JSON), `Relationship MR` / `Channel MR`, `Companies` (`Raw code`, `Company`), `Channels` (`Raw code`, `Channel`), `metadata.json` keys `sector, title, prefix, client, brands, channels, dimensions, metric_headers, grain, source_note`. `grain` states "Relationship: one customer per wave, rating one main provider" and "Channel: one most recent experience per customer per channel per wave".

What is not machine-readable in CSM: scale direction and polarity (only in labels), which items are satisfaction vs performance vs agreement vs importance (all `question_type=scale`), the driver-importance pairing (`company_driver_dXX` with `importance_dXX` is linked only by suffix and question IDs R3/R4), the switch-risk cut (8-10), SERVQUAL domain membership (only in the `derivation` text and variable names), and that 98 means not applicable.

## 3. Variable roles

### 3.1 Brand trackers: common schema

All four brand packs share one schema. Sector-specific names are given as BMW / banks / insurers / telecoms.

| Role | Question | Variables | Storage shape | Base (universe) | Codes and traps |
|---|---|---|---|---|---|
| Respondent ID | SYS | `respondent_id` | Text | All | Leading zeros; unique across waves. |
| Wave | SYS | `wave` | Categorical | All | 1 Feb 2026, 2 Jun 2026, 3 Oct 2026. |
| Fieldwork date | SYS | `fieldwork_date` | Text ISO date | All | |
| Synthetic flag | SYS | `synthetic` | Categorical | All | 1 only. Not analytic. |
| Weight | SYS | `weight` | Continuous, unit `relative weight` | All | Optional; sums to about 1,000 per wave; range W1 BMW 0.654 to 1.353. Kish n_eff about 960. |
| Screeners | S1 to S5 | `age`, `age_band`, `choice_role`, `last_acquired`, `next_acquire`, `category_active` (not BMW) | Single / numeric | All | `last_acquired=1` (past 12 months, or past 90 days in telecoms) routes O3 to O7. |
| Demographics | D1 to D5 | `gender`, `province`, `settlement`, `income`, `life_stage` | Single | All | `income` 99 = Prefer not to say (nonresponse). `gender` 4 = Prefer not to say is a valid category in reference tables (items 1-4). |
| Decision style | C1 | `decision_style` | Single | All | Category behaviour, not a brand variable. |
| Top of mind | A1 | `topmind` | Single brand code | All | 1-10 brands, 96 Other, 98 None. |
| Spontaneous awareness | A1/A2 | `unaided_b01..b10`, `awareness_verbatim` | Per-brand binary, MR set `unaided` | All | No `unaided_other` / `unaided_none` columns. Verbatim is `;`-separated brand names. |
| CEP recall (brand x situation) | M1 | `cep_cXX_bYY` (120), `cep_other_cXX`, `cep_verbatim_cXX`, `cep_order` | 12 MR sets `cep_c01`..`cep_c12`, each with 10 brand members | All (all 12 situations asked of everyone) | Unprompted. Other flag outside the set. `cep_order` is a `|`-joined rotation string. |
| Prompted awareness | A3 | `aware_b01..b10`, `brand_order` | Per-brand binary, MR set `aware` | All | `brand_order` is the per-respondent rotation (`b03|b10|...`), not data. `aware_none` is a separate derived exclusive flag. |
| Consideration | F1 | `consider_bYY` | Per-brand binary, MR `consider` | All (asked of recognised brands; unaware stored as 0) | Nested within aware in data. |
| Shortlist | F2 | `shortlist_bYY` | Per-brand binary, MR `shortlist` | All | Nested within consider. |
| First choice | F3 | `first_choice` (single code) and derived `firstchoice_bYY` (binary, not an MR set) | Both shapes present | All | `first_choice` 98 = "No first choice yet" and also "no shortlist, F3 not asked" (122 of 267 code-98 cases in BMW W1 had no shortlist). |
| Brand opinion / rejection | R1 | `opinion_bYY` | Per-brand single response | `aware_bYY=1`; blank if unaware | 1 Would never choose (rejector) .. 5 First choice; 9 Know name, no opinion (substantive). |
| Current relationship | O1 | `owner_bYY` / `current_bYY`, `*_other`, derived `*_none` | Per-brand binary, MR `owner` / `current` | All | Behavioural, separate from funnel. |
| Main brand | O2 | `main_brand` | Single brand code | Has a current vehicle / relationship | 96 Other. Universe for NPS and X2. |
| Recent acquisition / start | O3 | `bought12_bYY` / `started12_bYY` / `started90_bYY`, `*_other`, `*_none` | Per-brand binary | All (structural 0 outside route) | Telecoms uses a 90-day window. |
| Repeat | O4 | `repeat_bYY` (routed) and `repeat12_bYY` / `repeat_event_bYY` (all-sample derived) | Single per brand | `bought12_bYY=1` / `started*_bYY=1` | Not loyalty or frequency. |
| Acquisition / start channel | O5 | `acquisition_channel` / `start_channel` | Single, codes 1-7 | `last_acquired=1` | A buying channel list. Must not become a brand frame even when labels name banks (telecoms code 5 "Bank branch app or channel"). |
| Acquisition type | O6 | `acquisition_type` / `start_type` | Single | `last_acquired=1` | |
| Purchase journey | O7 | `journey_j01..j07` | MR `purchase_journey` | `last_acquired=1` | Touchpoints, not brands or attributes. |
| Category moments (relevance) | M2 | `relevant_c01..c12`, `relevant_none` | MR `category_situations`; None outside | All | Stated relevance, not CEP brand links. |
| Brand-attribute associations | I1 | `attr_aXX_bYY` (100), `attr_none_aXX`, `attr_dk_aXX`, `attribute_order` | 10 MR sets `attr_a01..a10` (one per attribute, 10 brand members); each member's universe is `aware_bYY=1` | Aware of that brand; blank if unaware | Pick-any. None and DK are per-attribute exclusive flags outside the sets. DK respondents keep 0 (not blank) in the aware cells and stay in the aware denominator (BMW W1: 40 aware-of-BMW respondents with `attr_dk_a01=1` all have `attr_a01_b08=0`; reference raw base 831 = all aware). |
| NPS (main brand) | I2 | `nps_main` | Scale 0-10 | `main_brand 1–10` | 99 Do not know (nonresponse). Score 9 is a valid promoter value. No NPS row in brand reference JSON. |
| Unprompted ad recall | AD1 | `ad_unaided_bYY`, `advertising_verbatim` | MR `ad_unaided` | All | Asked after the prompted list. |
| Prompted ad recall | AD2 | `adprompt_bYY` (routed), `adrecall_bYY` (derived all-sample Yes) | Single per brand | `aware_bYY=1` | 0 No, 1 Yes, 9 Not sure (substantive, reported separately). |
| Word of mouth | W1 | `wom_bYY` | Single per brand | `aware_bYY=1` | 1 positive, 2 negative, 3 mixed, 4 neutral, 5 not heard; unaware is a sixth reported state derived from blank. |
| Media use | P1 | `media_m01..m12`, `media_none` | MR `media`; None outside | All | Media list, not brands. |
| Products held | X1 (not BMW) | `product_p01..p04` | MR `current_products` | `category_active=1` | |
| Experience event | X2, X3 (not BMW) | `experience_event`, `experience_resolution` | Single | `main_brand 1–10`; `experience_event=1` | Resolution 9 = Still in progress (substantive). |
| Top-ups | X4 (telecoms only) | `topups30` | Continuous | `product_p01=1 or product_p03=1` | 0 is valid. |
| Derived | Derived | `aware_none`, `consider_none`, `shortlist_none`, `owner_none`/`current_none`, `bought12_none`/`started*_none`, `cep_links_bYY`, `mental_bYY`, `n_aware`, `n_consider`, `n_bought12`/`n_started*` | Categorical / continuous | All | `*_none` = 1 when all tracked and Other flags are 0. `cep_links_bYY` = sum of 12 CEP links; `mental_bYY` = 1 if links > 0. Repertoires exclude Other. |

Brand frames (code 1-10 = tracked brand, from `Brands` sheet / `metadata.json.brands`; 96 Other and 98 None or no choice are non-brands):

| Pack | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 (focal) | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| BMW | Toyota | Volkswagen | Ford | Hyundai | Kia | Nissan | Suzuki | BMW | Mercedes-Benz | Haval |
| Banking | Capitec | Standard Bank | Absa | Nedbank | African Bank | GoTyme Bank (formerly TymeBank) | Bank Zero | FNB | Discovery Bank | Investec |
| Insurance | Santam | Hollard | MiWay | Budget Insurance | Auto & General | Dialdirect | Discovery Insure | OUTsurance | Naked | King Price |
| Telecoms | MTN | Telkom Mobile | Cell C | FNB Connect | Capitec Connect | Standard Bank Connect | Melon Mobile | Vodacom | Afrihost Air Mobile | Mr Price Mobile |

Non-brand codes by variable: `topmind` 96 Other, 98 None; `first_choice` 98 No first choice yet (no 96); `main_brand` 96 Other (no 98). Brand-level Other exists only as `owner_other`/`current_other`, `bought12_other`/`started*_other`, `cep_other_cXX` binaries.

Funnel stage summary (all four packs): awareness unprompted = `unaided_bYY`; awareness prompted = `aware_bYY`; consideration = `consider_bYY`; shortlist = `shortlist_bYY`; first choice = `firstchoice_bYY` (or `first_choice` code). Usage and ownership are separate behavioural measures and are not part of the nested funnel.

### 3.2 CSM Relationship file (one row per customer per wave)

| Role | Question | Variables | Scale and special codes | Base |
|---|---|---|---|---|
| IDs, wave, date | SYS | `respondent_id`, `wave`, `interview_date` | Text ID; join key is (wave, respondent_id) | All |
| Company (brand frame) | S2 | `company` | Banking 1 FNB, 2 Standard Bank, 3 Absa, 4 Nedbank, 5 Capitec, 6 Discovery Bank, 7 GoTyme Bank. Mobile 1 Vodacom, 2 MTN, 3 Telkom Mobile, 4 Cell C, 5 FNB Connect, 6 Capitec Connect. Fixed allocations (banking FNB 200/wave; mobile Vodacom 320/wave) are not market shares. | All |
| Weight | SYS | `weight` | Relative, sums to 1,000 per wave; inherited by Channel rows | All |
| Demographics, segment, tenure | S1, D1-D4, SYS, S2 | `age`, `age_band`, `gender`, `province`, `income`, `settlement`, `segment`, `tenure_months` | `income` 99 nonresponse; `segment` 1-3 is a synthetic demonstration segment | All |
| Overall satisfaction (target) | R1 | `company_csat5` | 1 Very dissatisfied to 5 Very satisfied; 99 DK excluded. T2B = 4-5, top = 5, B2B = 1-2 | All |
| Versus expectations | R2 | `company_expectations5` | 1 Much worse to 5 Much better; 99 | All |
| Driver performance (predictors) | R3 | `company_driver_d01..d06` | 1 Very poor to 5 Excellent; 98 Not applicable; 99 DK. Performance, not satisfaction | All |
| Stated importance | R4 | `importance_d01..d06` | 1 Not important to 5 Extremely; 99 DK | All |
| Fairness, trust | R5 | `fairness5`, `trust5` | Agreement 1-5; 99 | All |
| Likelihood to recommend | L1 | `recommend_0to10` | 0-10; 99 DK. NPS = %9-10 minus %0-6, passives in base | All |
| Likely to stay | L2 | `continue5` | 1 Definitely not to 5 Definitely yes; 99. T2B = 4-5 | All |
| Likely to switch | L3 | `switch_0to10` | 0-10; 99. Risk = %8-10 (higher is worse) | All |
| Price switching, growth | L4 | `price_switch5`, `grow_business5` | Agreement 1-5; 99. Opposite favourable directions | All |
| Verbatim | L5 | `company_reason_text` | Text | All |
| Products | S3 | `product_p01..p04` | MR `products` | All |
| Complaints | C1-C3 | `complaint3m`; `complaint_reason_r01..r06` (MR `complaint_reasons`, r06 Other); `complaint_resolution` (1 Fully, 2 Partly, 3 Unresolved, 9 In progress); `complaint_handling_csat5` | Blank for non-complainants; 9 substantive | `complaint3m=1` for C2, C3 |
| Channel use screen | CH1, CH2 | `channel_used_c01..c04` (MR `channel_use`), `channel_none` (exclusive, outside MR), `channel_contacts_cXX` (count) | Banking channels 1 Call centre, 2 Branch, 3 Digital self service, 4 Messaging or live chat; mobile 2 = Retail store | All |

### 3.3 CSM Channel file (one row per most recent experience per customer per channel)

| Role | Variables | Scale and special codes | Base |
|---|---|---|---|
| Customer fields copied from Relationship | `respondent_id` .. `tenure_months` (same 13 columns) | Same weight per customer | All records |
| Experience ID | `experience_id` (for example `01100001-C2`) | Text | All |
| Recency | `contact_date`, `days_ago` | | All |
| Channel | `channel` | 1-4 as above | All |
| Digital mode | `digital_mode` | 1 App, 2 Website | `channel=3` |
| Staff contact | `staff_contact` | 0/1; in W1 data it is 0 for every digital self-service row and 1 for every other channel | All |
| Reasons | `primary_reason` (single), `reasons_r01..r06` (MR `experience_reasons`) | Sector-specific labels | All |
| Channel satisfaction | `channel_csat5` | 1-5; 99 | All |
| Ease | `ease7` | 1 Very difficult to 7 Very easy; 99. Ease % = 6-7 | All |
| Task completion | `task_completed` | 0 No, 1 Yes, 9 Pending (substantive) | All |
| Problem and resolution | `problem_present`, `problem_resolution` (1 Fully, 2 Partly, 3 Unresolved, 9 Pending), `contacts_same_need` | | `problem_present=1` |
| First contact resolution | `first_contact_resolution` | 1 only when fully resolved in one contact | `problem_present=1 and problem_resolution in 1,2,3` |
| Service quality items | `driver_reliable_accurate`, `driver_reliable_correct`, `driver_responsive_speed`, `driver_responsive_updates`, `driver_assurance_knowledge`, `driver_assurance_confidence`, `driver_empathy_understood`, `driver_empathy_respect`, `driver_access_ease`, `driver_access_clarity` | 1 Very poor to 5 Excellent; 98 N/A; 99 DK | Knowledge and empathy items: `staff_contact=1` |
| Domain means (derived) | `dimension_reliability`, `dimension_responsiveness`, `dimension_assurance`, `dimension_empathy`, `dimension_access_and_clarity` | Mean of two items, both valid required | Both items valid |
| Operational | `wait_minutes`, `handling_minutes`, `digital_response_seconds`, `transferred`, `put_on_hold`, `callback_promised`, `used_ivr`, `number_transfers`, `callback_outcome` (9 Not yet due), `ivr_csat5`, `ivr_clarity5`, `agent_introduced`, `agent_polite`, `preferred_language_assisted` | | Routed (`channel=1`, `staff_contact=1`, etc.) |
| Physical facilities | `branch_tidy5`, `branch_accessible5` | 1-5; 98; 99 | `channel=2` (named "branch" even in mobile, where code 2 is Retail store) |
| Verbatim | `channel_reason_text` | Text | All |

Drivers analysis: target `company_csat5` (Relationship grain); predictors `company_driver_d01..d06`; stated importance `importance_d01..d06` for a performance vs importance matrix. The guide requires distinct relationship customers, disclosed missing-data treatment (98/99), collinearity and uncertainty, and associational wording. Channel-grain drivers (`driver_*` to `channel_csat5`) involve repeated customers and are flagged as dependent data. No regression, correlation or relative-importance values are supplied in any reference file (see section 4.3).

Segments: `segment` (3 synthetic segments) plus filters listed in the guide: wave, company, age, gender, province, income, segment, product, tenure; Channel view adds channel, digital mode, reason, problem status, staff contact.

## 4. Reference values a dashboard must reproduce

### 4.1 Where the values live and how to address them

Brand packs: `reference_results.json` is an object `{schema_version, synthetic, results: [...]}`. Each row has `wave, chart, metric, brand, item, expected, numerator, denominator, raw_base, unit, base_definition, weighting`. Address a value as

`$.results[?(@.wave==W && @.chart=='<chart>' && @.metric=='<metric>' && @.brand=='<brand label>' && @.item=='<item>' && @.weighting=='unweighted'|'weighted')].expected`

The row key uses the brand label (for example `"BMW"`), not the raw code, and `item` holds the attribute or CEP label for grid metrics. Every metric exists in both `unweighted` and `weighted` form (except `Sample/effective_base`, weighted only). `Reference_Metrics.xlsx` sheet `Reference metrics` holds the same rows; the second sheet (`BMW overview` or `Focal overview`) repeats the weighted focal funnel and effective base.

| Dashboard element | chart / metric | Formula | Numerator | Denominator / base |
|---|---|---|---|---|
| Funnel stage per brand | `Funnel / timeline / advertising` / `unaided`, `aware`, `consider`, `shortlist`, `firstchoice` | 100 x sum(w x stage_bYY) / sum(w) | Respondents with stage_bYY = 1 | All eligible (1,000 raw) |
| Behaviour | same chart / `owner` or `current`, `bought12` or `started12`/`started90`, `repeat12` or `repeat_event`, `adrecall` | as above | | All eligible |
| Conversion | `Conversion` / `aware_to_consider`, `consider_to_shortlist`, `shortlist_to_firstchoice` | later stage / preceding stage | | Preceding stage = 1 |
| Focal gap | `Overview` / `<Focal>_gap_competitor_average`, item = stage | focal % minus unweighted mean of the 9 competitor %s | n/a (numerator and denominator null) | All eligible |
| Associations (aware base) | `Associations` / `attribute_aware`, item = attribute label | 100 x sum(w x attr_aXX_bYY) / sum(w x aware_bYY) | Linked | Aware of brand (DK kept in base) |
| Associations (reach) | `Associations` / `attribute_all` | same numerator / all eligible | | All eligible |
| Unfamiliar / rejectors | `Unfamiliar / rejectors` / `Unaware`, `Aware no opinion`, `Rejector` | aware=0; opinion=9; opinion=1 | | All eligible |
| Word of mouth | `Word of mouth` / `Positive`, `Negative`, `Mixed`, `Neutral`, `Not heard`, `Unaware` | Six states, sum to 100 | | All eligible |
| Top of mind (not BMW) | `Awareness` / `top_of_mind` | topmind = code | | All eligible |
| CEP metrics | `Brand moment strength` / `average_links_all`, `mental_penetration`, `network_size`, `mental_market_share`; `Moment brand matrix` / `link_all`, `link_among_aware`; `Brand fingerprint` / `actual_minus_expected_pp` | Formulas in the analysis guide (section "Memory measures") | | As named |
| Effective base | `Sample` / `effective_base`, item `Kish` | (sum w)^2 / sum(w^2) | | All eligible |

CSM packs: `reference_results.json` is a top-level array. Each row has `wave, dataset, company, channel, variable, statistic, expected, numerator, weighted_base, raw_base, unit`. `company` 0 = all companies, otherwise the raw company code; `channel` 0 for Relationship rows, otherwise the raw channel code. Address a value as

`$[?(@.wave==W && @.dataset=='Relationship' && @.company==C && @.channel==0 && @.variable=='company_csat5' && @.statistic=='t2b')].expected`

All CSM reference rows are weighted (`numerator` and `weighted_base` are weighted sums; `raw_base` is the valid unweighted n). There are no unweighted CSM reference rows. `CSM_Reference_Metrics.xlsx` sheet `Reference metrics` repeats the JSON; sheet `Focal company overview` holds the focal CSAT T2B, NPS, continue T2B and switch risk per wave (identical to the JSON rows for company 1).

| Statistic | Variable(s) | Formula | Valid base |
|---|---|---|---|
| `mean5` | `company_csat5`, `company_driver_d01..d06`, `channel_csat5`, the 10 channel `driver_*` items | Weighted mean of codes 1-5 | Codes 1-5 (98 and 99 excluded; blank not asked) |
| `t2b`, `top`, `b2b` | `company_csat5`, `channel_csat5`; `t2b` also `continue5` | 4-5; 5; 1-2 | Codes 1-5 |
| `dist1`..`dist5` | `company_csat5` | Share of each code | Codes 1-5 |
| `nps` | `recommend_0to10` | %9-10 minus %0-6 (score points) | Codes 0-10 (99 excluded) |
| `risk` | `switch_0to10` | %8-10 | Codes 0-10 |
| `yes` | `complaint3m`; `first_contact_resolution` | %1 | complaint: all; FCR: problem cases with resolution 1-3 |
| `mean7`, `ease` | `ease7` | Weighted mean 1-7; %6-7 | Codes 1-7 |

I reproduced CSAT T2B, NPS and switch risk for both CSM sectors, all waves, company 0 and the focal company, and one driver mean, from the CSVs with these rules; all matched the JSON to at least 4 dp, confirming the rows are weighted and 99 and 98 are excluded.

### 4.2 Brand overview reference values

Focal funnel per wave, plus the unweighted funnel for every brand and the focal brand's attribute associations. Values are from `reference_results.json`. The weighted focal funnel equals the `Focal overview` / `BMW overview` sheet of `Reference_Metrics.xlsx`.


#### BMW car (focal BMW)

Kish effective base (`chart=Sample, metric=effective_base, weighting=weighted`): W1 961.81, W2 960.70, W3 962.47

Unweighted funnel, % of all eligible (raw base 1,000 per wave). Cell = unaided / aware / consider / shortlist / firstchoice.

| Code | Brand | W1 | W2 | W3 |
|---|---|---|---|---|
| 1 | Toyota | 50.8 / 95.3 / 64.0 / 33.5 / 13.6 | 50.6 / 95.2 / 63.0 / 32.0 / 12.7 | 50.1 / 96.0 / 64.4 / 30.3 / 13.2 |
| 2 | Volkswagen | 37.2 / 90.2 / 52.1 / 27.6 / 10.9 | 37.0 / 90.9 / 52.7 / 27.1 / 11.3 | 39.3 / 91.0 / 52.1 / 27.6 / 11.6 |
| 3 | Ford | 24.8 / 85.4 / 38.6 / 17.9 / 7.6 | 29.3 / 85.8 / 39.5 / 18.0 / 7.2 | 25.7 / 85.4 / 40.7 / 21.8 / 8.8 |
| 4 | Hyundai | 23.2 / 82.7 / 38.7 / 20.5 / 9.1 | 24.5 / 86.5 / 42.3 / 22.8 / 8.8 | 23.5 / 83.3 / 38.7 / 20.4 / 7.3 |
| 5 | Kia | 20.7 / 80.8 / 34.5 / 18.1 / 5.9 | 17.0 / 77.8 / 35.6 / 17.4 / 6.7 | 15.7 / 75.5 / 31.6 / 16.7 / 6.0 |
| 6 | Nissan | 19.9 / 80.8 / 35.5 / 19.2 / 7.3 | 19.3 / 84.1 / 32.8 / 17.0 / 6.4 | 19.8 / 83.9 / 33.5 / 17.1 / 6.9 |
| 7 | Suzuki | 18.0 / 78.6 / 35.7 / 18.2 / 5.9 | 16.1 / 78.2 / 34.4 / 18.0 / 6.9 | 15.8 / 80.9 / 39.9 / 19.3 / 7.1 |
| 8 | BMW (focal) | 25.2 / 83.1 / 32.1 / 16.6 / 6.1 | 27.0 / 85.0 / 34.3 / 16.7 / 6.4 | 28.8 / 87.6 / 39.1 / 19.7 / 7.4 |
| 9 | Mercedes-Benz | 25.5 / 80.1 / 24.3 / 11.6 / 4.1 | 24.5 / 85.1 / 26.8 / 14.5 / 5.2 | 23.4 / 83.2 / 22.6 / 10.1 / 3.2 |
| 10 | Haval | 8.2 / 58.0 / 14.0 / 6.5 / 2.8 | 8.6 / 65.1 / 20.1 / 9.8 / 3.6 | 9.2 / 71.2 / 23.3 / 11.9 / 4.4 |

Weighted focal funnel (BMW), % (numerator and denominator are weighted sums):

| Stage | W1 | W2 | W3 |
|---|---|---|---|
| unaided | 25.5698 | 27.2758 | 28.3387 |
| aware | 82.7730 | 84.8879 | 87.6183 |
| consider | 31.8515 | 33.9823 | 39.0392 |
| shortlist | 16.0084 | 16.9065 | 19.6988 |
| firstchoice | 5.6710 | 6.6217 | 7.4767 |

Focal gap to equal-weight competitor average, pp (`metric=BMW_gap_competitor_average`, item=stage):

| Stage | Unweighted W1 | W2 | W3 | Weighted W1 | W2 | W3 |
|---|---|---|---|---|---|---|
| aware | 1.78 | 1.81 | 4.22 | 1.43 | 1.67 | 4.38 |
| consider | -5.39 | -4.28 | 0.57 | -5.55 | -4.58 | 0.64 |
| shortlist | -2.63 | -2.92 | 0.23 | -3.12 | -2.73 | 0.20 |
| firstchoice | -1.37 | -1.24 | -0.21 | -1.76 | -1.03 | -0.12 |

Focal attribute associations among brand-aware (`chart=Associations, metric=attribute_aware`), %; raw base = aware n:

| Code | Attribute | Unwtd W1 | W2 | W3 | Wtd W1 | W2 | W3 |
|---|---|---|---|---|---|---|---|
| a01 | Reliable | 36.22 | 34.12 | 34.25 | 36.79 | 34.79 | 33.99 |
| a02 | Affordable to run | 35.38 | 36.00 | 34.47 | 34.66 | 35.79 | 34.65 |
| a03 | Good value for money | 36.82 | 34.12 | 34.82 | 36.36 | 34.52 | 35.08 |
| a04 | Safe | 32.73 | 34.82 | 35.84 | 32.38 | 34.56 | 35.49 |
| a05 | Comfortable | 35.86 | 36.35 | 35.50 | 36.00 | 36.90 | 35.20 |
| a06 | Enjoyable to drive | 62.58 | 62.94 | 64.95 | 62.73 | 62.53 | 64.95 |
| a07 | Advanced technology | 66.06 | 66.94 | 68.72 | 66.05 | 67.35 | 68.35 |
| a08 | Premium quality | 65.10 | 65.06 | 62.90 | 65.00 | 64.96 | 63.39 |
| a09 | Environmentally responsible | 34.18 | 32.24 | 34.70 | 34.43 | 32.79 | 34.28 |
| a10 | Good dealer and aftersales support | 36.46 | 35.76 | 33.68 | 35.68 | 35.93 | 33.94 |

Aware raw base for BMW attributes: W1 831, W2 850, W3 876.

#### Banking (focal FNB)

Kish effective base (`chart=Sample, metric=effective_base, weighting=weighted`): W1 961.52, W2 959.96, W3 960.25

Unweighted funnel, % of all eligible (raw base 1,000 per wave). Cell = unaided / aware / consider / shortlist / firstchoice.

| Code | Brand | W1 | W2 | W3 |
|---|---|---|---|---|
| 1 | Capitec | 49.7 / 96.1 / 64.3 / 33.2 / 13.4 | 52.3 / 95.9 / 63.8 / 33.9 / 13.7 | 51.2 / 96.8 / 63.8 / 31.3 / 11.2 |
| 2 | Standard Bank | 39.0 / 95.3 / 55.0 / 28.9 / 11.1 | 38.0 / 95.1 / 55.2 / 28.3 / 12.3 | 39.3 / 95.5 / 54.6 / 28.6 / 11.8 |
| 3 | Absa | 28.7 / 92.0 / 40.9 / 20.9 / 8.2 | 28.4 / 92.6 / 41.4 / 19.0 / 7.5 | 28.2 / 92.1 / 41.9 / 20.9 / 7.0 |
| 4 | Nedbank | 23.8 / 90.9 / 41.9 / 20.9 / 9.0 | 24.0 / 89.9 / 44.6 / 22.7 / 9.2 | 23.8 / 88.4 / 40.8 / 22.1 / 7.8 |
| 5 | African Bank | 18.2 / 76.6 / 32.0 / 14.8 / 5.8 | 16.7 / 73.5 / 31.5 / 15.0 / 6.0 | 17.5 / 75.1 / 34.0 / 16.3 / 7.0 |
| 6 | GoTyme Bank (formerly TymeBank) | 18.3 / 79.2 / 30.3 / 14.8 / 6.7 | 18.4 / 79.4 / 31.1 / 16.2 / 5.5 | 18.6 / 79.8 / 33.1 / 17.9 / 6.8 |
| 7 | Bank Zero | 10.2 / 43.7 / 20.4 / 9.2 / 4.3 | 9.1 / 45.6 / 21.0 / 9.4 / 3.7 | 8.7 / 43.9 / 19.9 / 9.4 / 3.6 |
| 8 | FNB (focal) | 29.7 / 93.7 / 37.5 / 19.2 / 7.7 | 31.2 / 96.6 / 41.3 / 21.6 / 9.0 | 32.1 / 98.1 / 48.5 / 26.1 / 11.8 |
| 9 | Discovery Bank | 22.3 / 79.3 / 21.7 / 11.0 / 4.3 | 22.4 / 75.2 / 20.8 / 10.4 / 4.3 | 22.9 / 78.1 / 24.4 / 12.6 / 4.8 |
| 10 | Investec | 6.4 / 52.0 / 12.3 / 7.0 / 2.6 | 7.6 / 58.5 / 17.1 / 9.4 / 4.4 | 9.2 / 64.6 / 23.4 / 12.1 / 4.2 |

Weighted focal funnel (FNB), % (numerator and denominator are weighted sums):

| Stage | W1 | W2 | W3 |
|---|---|---|---|
| unaided | 29.8645 | 31.4789 | 31.7930 |
| aware | 93.5682 | 96.6447 | 98.1889 |
| consider | 37.5693 | 41.1610 | 48.6555 |
| shortlist | 19.3547 | 21.3493 | 26.0534 |
| firstchoice | 7.7890 | 8.6009 | 12.1033 |

Focal gap to equal-weight competitor average, pp (`metric=FNB_gap_competitor_average`, item=stage):

| Stage | Unweighted W1 | W2 | W3 | Weighted W1 | W2 | W3 |
|---|---|---|---|---|---|---|
| aware | 15.36 | 18.19 | 18.73 | 15.25 | 18.36 | 18.80 |
| consider | 2.08 | 5.02 | 11.18 | 2.20 | 4.77 | 11.25 |
| shortlist | 1.34 | 3.34 | 7.08 | 1.60 | 3.03 | 7.13 |
| firstchoice | 0.43 | 1.60 | 4.67 | 0.55 | 1.14 | 5.04 |

Focal attribute associations among brand-aware (`chart=Associations, metric=attribute_aware`), %; raw base = aware n:

| Code | Attribute | Unwtd W1 | W2 | W3 | Wtd W1 | W2 | W3 |
|---|---|---|---|---|---|---|---|
| a01 | Keeps money safe | 35.97 | 37.06 | 34.76 | 36.39 | 36.89 | 34.81 |
| a02 | Has low transparent fees | 37.03 | 37.27 | 37.61 | 36.99 | 37.45 | 37.30 |
| a03 | Makes everyday banking easy | 34.79 | 36.65 | 39.76 | 34.62 | 36.43 | 39.56 |
| a04 | Has a reliable easy-to-use app | 56.14 | 60.14 | 61.47 | 56.28 | 59.70 | 61.66 |
| a05 | Provides helpful service | 36.07 | 36.85 | 39.35 | 36.22 | 36.40 | 39.61 |
| a06 | Makes cash access convenient | 35.11 | 37.27 | 36.49 | 35.03 | 37.34 | 36.47 |
| a07 | Offers useful rewards | 57.95 | 58.18 | 56.07 | 57.44 | 57.99 | 56.30 |
| a08 | Understands people like me | 35.22 | 35.51 | 37.51 | 34.96 | 35.65 | 37.78 |
| a09 | Helps me manage and save money | 52.72 | 55.38 | 58.31 | 52.53 | 55.52 | 58.16 |
| a10 | Resolves problems fairly | 35.22 | 34.27 | 37.00 | 35.55 | 34.05 | 37.58 |

Aware raw base for FNB attributes: W1 937, W2 966, W3 981.

#### Insurance (focal OUTsurance)

Kish effective base (`chart=Sample, metric=effective_base, weighting=weighted`): W1 962.14, W2 959.33, W3 959.28

Unweighted funnel, % of all eligible (raw base 1,000 per wave). Cell = unaided / aware / consider / shortlist / firstchoice.

| Code | Brand | W1 | W2 | W3 |
|---|---|---|---|---|
| 1 | Santam | 47.5 / 91.0 / 62.4 / 31.5 / 13.8 | 45.4 / 90.6 / 59.7 / 30.2 / 13.3 | 47.5 / 91.5 / 60.7 / 30.7 / 11.8 |
| 2 | Hollard | 36.2 / 84.8 / 50.8 / 26.4 / 12.4 | 33.5 / 85.8 / 48.2 / 23.4 / 10.5 | 36.9 / 84.9 / 47.2 / 24.8 / 8.9 |
| 3 | MiWay | 25.8 / 82.8 / 36.5 / 18.6 / 7.9 | 22.8 / 81.5 / 36.5 / 17.6 / 7.2 | 21.8 / 82.3 / 37.1 / 18.8 / 7.3 |
| 4 | Budget Insurance | 22.7 / 78.8 / 35.4 / 18.4 / 7.1 | 21.9 / 81.8 / 40.1 / 22.5 / 8.6 | 20.8 / 79.4 / 37.8 / 19.5 / 8.1 |
| 5 | Auto & General | 17.5 / 77.3 / 32.3 / 16.5 / 6.4 | 17.1 / 75.7 / 34.0 / 16.7 / 6.9 | 15.0 / 76.6 / 31.6 / 16.7 / 6.4 |
| 6 | Dialdirect | 18.2 / 72.9 / 27.2 / 13.7 / 5.5 | 17.1 / 70.0 / 28.0 / 14.4 / 4.4 | 16.1 / 69.3 / 27.1 / 13.7 / 5.9 |
| 7 | Discovery Insure | 15.7 / 73.3 / 35.1 / 17.3 / 7.2 | 14.7 / 74.7 / 32.8 / 15.7 / 6.3 | 17.5 / 73.8 / 33.7 / 17.4 / 7.2 |
| 8 | OUTsurance (focal) | 31.0 / 92.5 / 34.8 / 18.9 / 9.5 | 28.6 / 95.0 / 39.7 / 21.6 / 9.0 | 30.5 / 96.5 / 50.7 / 25.6 / 10.6 |
| 9 | Naked | 13.4 / 51.9 / 13.9 / 7.5 / 3.0 | 13.8 / 48.7 / 16.9 / 8.1 / 2.9 | 13.4 / 49.8 / 14.5 / 8.0 / 2.6 |
| 10 | King Price | 10.3 / 76.9 / 17.4 / 9.5 / 3.7 | 9.4 / 77.1 / 23.1 / 11.9 / 4.2 | 10.5 / 84.0 / 29.3 / 15.1 / 5.5 |

Weighted focal funnel (OUTsurance), % (numerator and denominator are weighted sums):

| Stage | W1 | W2 | W3 |
|---|---|---|---|
| unaided | 30.5940 | 28.4566 | 30.1308 |
| aware | 92.2642 | 94.9544 | 96.5174 |
| consider | 34.8213 | 39.4777 | 50.5607 |
| shortlist | 18.6818 | 21.2916 | 25.6904 |
| firstchoice | 9.4660 | 8.9301 | 10.9327 |

Focal gap to equal-weight competitor average, pp (`metric=OUTsurance_gap_competitor_average`, item=stage):

| Stage | Unweighted W1 | W2 | W3 | Weighted W1 | W2 | W3 |
|---|---|---|---|---|---|---|
| aware | 15.87 | 18.79 | 19.66 | 15.58 | 18.86 | 19.66 |
| consider | 0.24 | 4.22 | 15.26 | 0.09 | 4.03 | 15.10 |
| shortlist | 1.19 | 3.77 | 7.30 | 0.93 | 3.51 | 7.42 |
| firstchoice | 2.06 | 1.86 | 3.52 | 2.00 | 1.80 | 3.88 |

Focal attribute associations among brand-aware (`chart=Associations, metric=attribute_aware`), %; raw base = aware n:

| Code | Attribute | Unwtd W1 | W2 | W3 | Wtd W1 | W2 | W3 |
|---|---|---|---|---|---|---|---|
| a01 | Pays valid claims fairly | 59.78 | 58.74 | 60.41 | 59.88 | 59.04 | 59.91 |
| a02 | Offers good value premiums | 36.22 | 36.63 | 38.34 | 36.37 | 36.31 | 38.14 |
| a03 | Explains cover and exclusions clearly | 34.38 | 37.26 | 37.51 | 34.35 | 36.67 | 36.96 |
| a04 | Provides helpful service | 37.30 | 38.74 | 35.75 | 37.27 | 38.77 | 36.31 |
| a05 | Makes claims easy | 54.49 | 59.37 | 64.04 | 54.35 | 59.15 | 64.15 |
| a06 | Provides reliable emergency assistance | 36.76 | 39.58 | 35.54 | 37.06 | 38.85 | 35.56 |
| a07 | Offers flexible cover | 37.62 | 33.47 | 39.48 | 38.10 | 33.18 | 39.64 |
| a08 | Has an easy digital experience | 38.59 | 37.05 | 34.72 | 38.22 | 36.90 | 34.72 |
| a09 | Is trustworthy | 56.65 | 59.58 | 55.96 | 56.58 | 59.27 | 56.09 |
| a10 | Treats customers fairly | 55.46 | 56.42 | 57.62 | 55.57 | 56.17 | 57.28 |

Aware raw base for OUTsurance attributes: W1 925, W2 950, W3 965.

#### Telecoms (focal Vodacom)

Kish effective base (`chart=Sample, metric=effective_base, weighting=weighted`): W1 962.59, W2 958.72, W3 962.01

Unweighted funnel, % of all eligible (raw base 1,000 per wave). Cell = unaided / aware / consider / shortlist / firstchoice.

| Code | Brand | W1 | W2 | W3 |
|---|---|---|---|---|
| 1 | MTN | 51.2 / 96.9 / 65.0 / 33.3 / 14.3 | 50.2 / 97.2 / 67.3 / 32.8 / 15.2 | 49.2 / 97.1 / 66.1 / 36.3 / 16.6 |
| 2 | Telkom Mobile | 41.4 / 93.6 / 56.1 / 29.0 / 13.1 | 38.2 / 92.1 / 55.5 / 28.6 / 12.2 | 37.0 / 91.9 / 53.4 / 29.4 / 13.1 |
| 3 | Cell C | 28.6 / 86.5 / 38.9 / 16.8 / 8.1 | 26.9 / 86.9 / 38.0 / 18.9 / 8.2 | 26.5 / 88.1 / 38.4 / 18.7 / 6.2 |
| 4 | FNB Connect | 18.8 / 70.8 / 32.4 / 15.1 / 6.6 | 19.6 / 71.4 / 32.3 / 17.0 / 6.5 | 20.2 / 69.7 / 30.5 / 14.1 / 6.0 |
| 5 | Capitec Connect | 15.6 / 71.4 / 29.6 / 14.3 / 5.6 | 16.4 / 72.6 / 32.2 / 16.6 / 6.7 | 17.4 / 71.9 / 32.5 / 16.9 / 8.3 |
| 6 | Standard Bank Connect | 12.6 / 45.5 / 18.1 / 9.5 / 3.9 | 13.0 / 46.2 / 18.9 / 9.1 / 3.5 | 10.4 / 47.5 / 18.6 / 9.8 / 3.6 |
| 7 | Melon Mobile | 8.8 / 42.1 / 19.4 / 10.1 / 4.8 | 9.2 / 43.2 / 19.0 / 9.3 / 4.0 | 10.2 / 44.3 / 20.3 / 10.8 / 4.0 |
| 8 | Vodacom (focal) | 31.8 / 98.1 / 39.2 / 20.7 / 9.2 | 31.5 / 99.1 / 45.9 / 24.3 / 11.9 | 31.9 / 100.0 / 51.9 / 26.3 / 10.5 |
| 9 | Afrihost Air Mobile | 12.3 / 43.2 / 14.1 / 7.0 / 2.5 | 12.4 / 43.6 / 11.9 / 6.1 / 2.4 | 13.8 / 43.0 / 13.1 / 6.0 / 1.7 |
| 10 | Mr Price Mobile | 6.4 / 49.1 / 11.8 / 6.5 / 3.1 | 6.9 / 55.2 / 15.8 / 7.7 / 2.4 | 7.7 / 64.1 / 22.4 / 10.7 / 4.0 |

Weighted focal funnel (Vodacom), % (numerator and denominator are weighted sums):

| Stage | W1 | W2 | W3 |
|---|---|---|---|
| unaided | 31.9514 | 32.1773 | 32.1010 |
| aware | 98.2285 | 99.2516 | 100.0000 |
| consider | 39.1496 | 45.6979 | 51.8575 |
| shortlist | 20.7637 | 24.2711 | 26.0625 |
| firstchoice | 9.3255 | 11.8068 | 10.1814 |

Focal gap to equal-weight competitor average, pp (`metric=Vodacom_gap_competitor_average`, item=stage):

| Stage | Unweighted W1 | W2 | W3 | Weighted W1 | W2 | W3 |
|---|---|---|---|---|---|---|
| aware | 31.53 | 31.50 | 31.38 | 31.54 | 31.71 | 31.41 |
| consider | 7.49 | 13.58 | 19.09 | 7.25 | 13.37 | 19.08 |
| shortlist | 4.97 | 8.07 | 9.33 | 4.95 | 7.99 | 9.16 |
| firstchoice | 2.31 | 5.11 | 3.44 | 2.46 | 4.98 | 3.08 |

Focal attribute associations among brand-aware (`chart=Associations, metric=attribute_aware`), %; raw base = aware n:

| Code | Attribute | Unwtd W1 | W2 | W3 | Wtd W1 | W2 | W3 |
|---|---|---|---|---|---|---|---|
| a01 | Has reliable coverage | 62.08 | 62.97 | 63.10 | 62.27 | 63.02 | 63.29 |
| a02 | Offers affordable data | 38.53 | 39.05 | 37.40 | 38.35 | 39.65 | 37.01 |
| a03 | Offers affordable calls | 38.63 | 40.06 | 38.10 | 38.74 | 39.81 | 38.72 |
| a04 | Has fast mobile data | 60.14 | 63.57 | 60.80 | 60.18 | 63.48 | 60.61 |
| a05 | Makes costs and expiry rules clear | 36.80 | 39.05 | 39.40 | 36.76 | 39.36 | 39.47 |
| a06 | Provides helpful service | 37.51 | 37.84 | 39.50 | 37.85 | 38.05 | 39.85 |
| a07 | Makes self service easy | 37.21 | 37.03 | 39.50 | 37.13 | 37.14 | 39.91 |
| a08 | Offers flexible packages | 35.78 | 39.56 | 40.00 | 35.58 | 39.62 | 40.44 |
| a09 | Makes switching simple | 40.06 | 40.26 | 38.60 | 39.83 | 39.79 | 38.57 |
| a10 | Has useful rewards or extras | 37.21 | 37.54 | 36.90 | 36.85 | 37.36 | 37.37 |

Aware raw base for Vodacom attributes: W1 981, W2 991, W3 1000.

### 4.3 CSM overview reference values

All values weighted, from `test-reference/reference_results.json`. "All" = `company 0`. The NPS component table is not in any reference file; I derived it from the CSVs with the documented rule and it reproduces the stored NPS exactly, so it can be used as a secondary fixture but should be labelled as derived.


#### banking CSM: company overview (Relationship grain, weighted)

| Metric (variable, statistic) | Company | W1 | W2 | W3 | Raw base W1/W2/W3 |
|---|---|---|---|---|---|
| CSAT mean 1-5 (`company_csat5`, `mean5`) | All | 3.6004 | 3.6719 | 3.7069 | 985/989/984 |
| CSAT mean 1-5 (`company_csat5`, `mean5`) | FNB | 3.6956 | 3.7493 | 3.7569 | 198/199/194 |
| CSAT T2B % (4-5) (`company_csat5`, `t2b`) | All | 55.7238 | 59.7082 | 61.7910 | 985/989/984 |
| CSAT T2B % (4-5) (`company_csat5`, `t2b`) | FNB | 61.8399 | 63.2555 | 62.7249 | 198/199/194 |
| CSAT top box % (5) (`company_csat5`, `top`) | All | 13.8005 | 16.8923 | 16.7792 | 985/989/984 |
| CSAT top box % (5) (`company_csat5`, `top`) | FNB | 16.7667 | 20.5179 | 19.6412 | 198/199/194 |
| CSAT bottom two % (1-2) (`company_csat5`, `b2b`) | All | 9.1549 | 8.7679 | 7.3303 | 985/989/984 |
| CSAT bottom two % (1-2) (`company_csat5`, `b2b`) | FNB | 8.6629 | 8.8402 | 6.2619 | 198/199/194 |
| NPS score (pts) (`recommend_0to10`, `nps`) | All | 2.6114 | 7.2260 | 12.4444 | 978/970/970 |
| NPS score (pts) (`recommend_0to10`, `nps`) | FNB | 6.1533 | 11.5020 | 17.5323 | 199/191/194 |
| Continue T2B % (4-5) (`continue5`, `t2b`) | All | 65.2795 | 68.3345 | 70.8038 | 975/973/976 |
| Continue T2B % (4-5) (`continue5`, `t2b`) | FNB | 70.8847 | 71.9250 | 70.6364 | 193/195/195 |
| Switch risk % (8-10) (`switch_0to10`, `risk`) | All | 1.7382 | 1.0568 | 1.1951 | 980/982/982 |
| Switch risk % (8-10) (`switch_0to10`, `risk`) | FNB | 1.5972 | 1.3861 | 2.3398 | 196/197/196 |
| Complaint past 3 months % yes (`complaint3m`, `yes`) | All | 18.0515 | 15.8574 | 14.4208 | 1000/1000/1000 |
| Complaint past 3 months % yes (`complaint3m`, `yes`) | FNB | 21.7496 | 18.2167 | 12.2151 | 200/200/200 |

#### banking: NPS components (derived in this session from the CSVs; not stored in reference JSON)

| Company | Wave | Promoters % (9-10) | Passives % (7-8) | Detractors % (0-6) | NPS | Valid n | Code 99 n |
|---|---|---|---|---|---|---|---|
| All | 1 | 31.9618 | 38.6878 | 29.3504 | 2.6114 | 978 | 22 |
| All | 2 | 34.6696 | 37.8867 | 27.4436 | 7.2260 | 970 | 30 |
| All | 3 | 36.5597 | 39.3249 | 24.1153 | 12.4444 | 970 | 30 |
| FNB | 1 | 35.1067 | 35.9399 | 28.9534 | 6.1533 | 199 | 1 |
| FNB | 2 | 36.0272 | 39.4476 | 24.5252 | 11.5020 | 191 | 9 |
| FNB | 3 | 39.1416 | 39.2490 | 21.6094 | 17.5323 | 194 | 6 |

#### banking: company driver performance means (R3, 1-5, 98/99 excluded, weighted)

| Driver | Label | All W1 | All W2 | All W3 | FNB W1 | FNB W2 | FNB W3 |
|---|---|---|---|---|---|---|---|
| `company_driver_d01` | Services work accurately and reliably | 3.6404 | 3.7640 | 3.8378 | 3.6864 | 3.8563 | 3.8726 |
| `company_driver_d02` | Help is provided promptly | 3.4090 | 3.4818 | 3.5959 | 3.4824 | 3.5290 | 3.5997 |
| `company_driver_d03` | I feel confident about security | 3.7088 | 3.8261 | 3.9120 | 3.7066 | 3.8791 | 3.9547 |
| `company_driver_d04` | The bank understands my needs | 3.5480 | 3.5863 | 3.6468 | 3.5979 | 3.6497 | 3.6669 |
| `company_driver_d05` | Banking channels are easy to access | 3.6876 | 3.7552 | 3.8800 | 3.6840 | 3.7768 | 3.8704 |
| `company_driver_d06` | Fees represent good value | 3.3708 | 3.5202 | 3.5780 | 3.3833 | 3.6527 | 3.6313 |

#### banking: channel view, all companies (company=0), weighted, event grain

| Channel (code) | Metric | W1 | W2 | W3 | Raw base W1/W2/W3 |
|---|---|---|---|---|---|
| Call centre (1) | Channel CSAT T2B % (`channel_csat5`, `t2b`) | 51.7809 | 39.3165 | 59.5003 | 359/327/320 |
| Call centre (1) | Channel CSAT mean (`channel_csat5`, `mean5`) | 3.4464 | 3.1892 | 3.6961 | 359/327/320 |
| Call centre (1) | Ease mean 1-7 (`ease7`, `mean7`) | 4.7732 | 4.5514 | 5.1565 | 352/324/321 |
| Call centre (1) | Ease % 6-7 (`ease7`, `ease`) | 29.8459 | 23.3867 | 43.0021 | 352/324/321 |
| Call centre (1) | FCR % (`first_contact_resolution`, `yes`) | 32.6206 | 34.3397 | 33.5825 | 138/143/132 |
| Branch (2) | Channel CSAT T2B % (`channel_csat5`, `t2b`) | 57.5375 | 54.1742 | 58.7126 | 283/288/258 |
| Branch (2) | Channel CSAT mean (`channel_csat5`, `mean5`) | 3.6012 | 3.6466 | 3.6974 | 283/288/258 |
| Branch (2) | Ease mean 1-7 (`ease7`, `mean7`) | 4.9859 | 5.1189 | 5.2332 | 276/286/252 |
| Branch (2) | Ease % 6-7 (`ease7`, `ease`) | 33.2882 | 38.0598 | 39.3369 | 276/286/252 |
| Branch (2) | FCR % (`first_contact_resolution`, `yes`) | 44.6391 | 40.8947 | 37.5236 | 81/103/100 |
| Digital self service (3) | Channel CSAT T2B % (`channel_csat5`, `t2b`) | 61.4463 | 65.6280 | 80.1142 | 744/753/726 |
| Digital self service (3) | Channel CSAT mean (`channel_csat5`, `mean5`) | 3.7080 | 3.8178 | 4.1495 | 744/753/726 |
| Digital self service (3) | Ease mean 1-7 (`ease7`, `mean7`) | 5.2170 | 5.3305 | 5.8091 | 728/742/730 |
| Digital self service (3) | Ease % 6-7 (`ease7`, `ease`) | 43.4495 | 46.3260 | 65.2906 | 728/742/730 |
| Digital self service (3) | FCR % (`first_contact_resolution`, `yes`) | 37.1722 | 37.3188 | 38.7928 | 176/187/180 |
| Messaging or live chat (4) | Channel CSAT T2B % (`channel_csat5`, `t2b`) | 60.0187 | 60.9788 | 64.4919 | 214/252/230 |
| Messaging or live chat (4) | Channel CSAT mean (`channel_csat5`, `mean5`) | 3.7367 | 3.7313 | 3.7760 | 214/252/230 |
| Messaging or live chat (4) | Ease mean 1-7 (`ease7`, `mean7`) | 5.2074 | 5.1121 | 5.3013 | 213/255/226 |
| Messaging or live chat (4) | Ease % 6-7 (`ease7`, `ease`) | 43.7014 | 35.3697 | 44.3431 | 213/255/226 |
| Messaging or live chat (4) | FCR % (`first_contact_resolution`, `yes`) | 35.3337 | 41.2765 | 36.7478 | 74/85/74 |

#### mobile CSM: company overview (Relationship grain, weighted)

| Metric (variable, statistic) | Company | W1 | W2 | W3 | Raw base W1/W2/W3 |
|---|---|---|---|---|---|
| CSAT mean 1-5 (`company_csat5`, `mean5`) | All | 3.4756 | 3.4270 | 3.6861 | 989/983/988 |
| CSAT mean 1-5 (`company_csat5`, `mean5`) | Vodacom | 3.5536 | 3.3933 | 3.6609 | 314/310/317 |
| CSAT T2B % (4-5) (`company_csat5`, `t2b`) | All | 49.7587 | 46.6157 | 58.2614 | 989/983/988 |
| CSAT T2B % (4-5) (`company_csat5`, `t2b`) | Vodacom | 55.8163 | 45.0734 | 57.9855 | 314/310/317 |
| CSAT top box % (5) (`company_csat5`, `top`) | All | 10.4208 | 11.5264 | 18.4138 | 989/983/988 |
| CSAT top box % (5) (`company_csat5`, `top`) | Vodacom | 10.9704 | 10.4393 | 18.4414 | 314/310/317 |
| CSAT bottom two % (1-2) (`company_csat5`, `b2b`) | All | 11.7930 | 14.2940 | 7.6430 | 989/983/988 |
| CSAT bottom two % (1-2) (`company_csat5`, `b2b`) | Vodacom | 10.0598 | 15.4127 | 9.2902 | 314/310/317 |
| NPS score (pts) (`recommend_0to10`, `nps`) | All | 1.9089 | -11.4519 | 12.1374 | 970/973/984 |
| NPS score (pts) (`recommend_0to10`, `nps`) | Vodacom | 5.7534 | -12.8424 | 15.0137 | 314/310/314 |
| Continue T2B % (4-5) (`continue5`, `t2b`) | All | 64.1314 | 57.6403 | 67.2246 | 977/971/962 |
| Continue T2B % (4-5) (`continue5`, `t2b`) | Vodacom | 69.4256 | 56.3508 | 66.2219 | 312/315/310 |
| Switch risk % (8-10) (`switch_0to10`, `risk`) | All | 2.6837 | 2.8517 | 1.2296 | 973/986/986 |
| Switch risk % (8-10) (`switch_0to10`, `risk`) | Vodacom | 2.9409 | 4.0938 | 1.7430 | 316/315/317 |
| Complaint past 3 months % yes (`complaint3m`, `yes`) | All | 18.6753 | 19.7140 | 14.6224 | 1000/1000/1000 |
| Complaint past 3 months % yes (`complaint3m`, `yes`) | Vodacom | 18.3042 | 15.9367 | 13.4813 | 320/320/320 |

#### mobile: NPS components (derived in this session from the CSVs; not stored in reference JSON)

| Company | Wave | Promoters % (9-10) | Passives % (7-8) | Detractors % (0-6) | NPS | Valid n | Code 99 n |
|---|---|---|---|---|---|---|---|
| All | 1 | 31.9165 | 38.0760 | 30.0075 | 1.9089 | 970 | 30 |
| All | 2 | 24.1153 | 40.3175 | 35.5672 | -11.4519 | 973 | 27 |
| All | 3 | 37.1124 | 37.9126 | 24.9750 | 12.1374 | 984 | 16 |
| Vodacom | 1 | 35.2290 | 35.2954 | 29.4756 | 5.7534 | 314 | 6 |
| Vodacom | 2 | 25.3784 | 36.4008 | 38.2208 | -12.8424 | 310 | 10 |
| Vodacom | 3 | 40.9793 | 33.0551 | 25.9656 | 15.0137 | 314 | 6 |

#### mobile: company driver performance means (R3, 1-5, 98/99 excluded, weighted)

| Driver | Label | All W1 | All W2 | All W3 | Vodacom W1 | Vodacom W2 | Vodacom W3 |
|---|---|---|---|---|---|---|---|
| `company_driver_d01` | Calls and data work reliably | 3.6438 | 3.5015 | 3.7271 | 3.6609 | 3.4910 | 3.6810 |
| `company_driver_d02` | Help is provided promptly | 3.3335 | 3.2301 | 3.5256 | 3.3233 | 3.1373 | 3.5071 |
| `company_driver_d03` | Billing and account information inspire confidence | 3.7176 | 3.5885 | 3.8491 | 3.7572 | 3.5579 | 3.7852 |
| `company_driver_d04` | The provider understands my needs | 3.4629 | 3.3408 | 3.6019 | 3.4631 | 3.2762 | 3.6341 |
| `company_driver_d05` | Services and support are easy to access | 3.6436 | 3.5337 | 3.8096 | 3.6627 | 3.5203 | 3.7514 |
| `company_driver_d06` | Packages represent good value | 3.3396 | 3.1811 | 3.4718 | 3.4029 | 3.1371 | 3.4483 |

#### mobile: channel view, all companies (company=0), weighted, event grain

| Channel (code) | Metric | W1 | W2 | W3 | Raw base W1/W2/W3 |
|---|---|---|---|---|---|
| Call centre (1) | Channel CSAT T2B % (`channel_csat5`, `t2b`) | 49.3815 | 39.2919 | 57.9199 | 358/377/388 |
| Call centre (1) | Channel CSAT mean (`channel_csat5`, `mean5`) | 3.4754 | 3.2675 | 3.6202 | 358/377/388 |
| Call centre (1) | Ease mean 1-7 (`ease7`, `mean7`) | 4.9194 | 4.7370 | 5.0393 | 357/377/383 |
| Call centre (1) | Ease % 6-7 (`ease7`, `ease`) | 32.4003 | 26.3515 | 34.9208 | 357/377/383 |
| Call centre (1) | FCR % (`first_contact_resolution`, `yes`) | 34.6512 | 33.1941 | 35.9548 | 135/139/153 |
| Retail store (2) | Channel CSAT T2B % (`channel_csat5`, `t2b`) | 53.3858 | 40.1356 | 55.1957 | 189/218/212 |
| Retail store (2) | Channel CSAT mean (`channel_csat5`, `mean5`) | 3.5235 | 3.3339 | 3.6140 | 189/218/212 |
| Retail store (2) | Ease mean 1-7 (`ease7`, `mean7`) | 4.8971 | 4.6966 | 5.0659 | 193/218/210 |
| Retail store (2) | Ease % 6-7 (`ease7`, `ease`) | 31.4000 | 27.5673 | 35.3247 | 193/218/210 |
| Retail store (2) | FCR % (`first_contact_resolution`, `yes`) | 38.4265 | 32.8094 | 41.1320 | 74/102/81 |
| Digital self service (3) | Channel CSAT T2B % (`channel_csat5`, `t2b`) | 56.6080 | 55.7730 | 63.4939 | 692/644/689 |
| Digital self service (3) | Channel CSAT mean (`channel_csat5`, `mean5`) | 3.6230 | 3.5752 | 3.8194 | 692/644/689 |
| Digital self service (3) | Ease mean 1-7 (`ease7`, `mean7`) | 5.1066 | 5.0281 | 5.2972 | 681/634/675 |
| Digital self service (3) | Ease % 6-7 (`ease7`, `ease`) | 37.4331 | 36.0258 | 46.7144 | 681/634/675 |
| Digital self service (3) | FCR % (`first_contact_resolution`, `yes`) | 37.7139 | 42.2572 | 33.0421 | 169/135/154 |
| Messaging or live chat (4) | Channel CSAT T2B % (`channel_csat5`, `t2b`) | 50.0395 | 41.4283 | 49.8920 | 242/239/266 |
| Messaging or live chat (4) | Channel CSAT mean (`channel_csat5`, `mean5`) | 3.4792 | 3.3207 | 3.5575 | 242/239/266 |
| Messaging or live chat (4) | Ease mean 1-7 (`ease7`, `mean7`) | 4.8455 | 4.8446 | 5.0734 | 241/237/263 |
| Messaging or live chat (4) | Ease % 6-7 (`ease7`, `ease`) | 27.6051 | 33.3640 | 39.6294 | 241/237/263 |
| Messaging or live chat (4) | FCR % (`first_contact_resolution`, `yes`) | 29.7481 | 30.0293 | 34.8170 | 94/100/101 |

Also stored but not tabulated here: `company_csat5` `dist1`..`dist5` and every Relationship statistic per company code (1-7 banking, 1-6 mobile); Channel statistics per company and channel (`company` 1..n, `channel` 1-4); `mean5` for each of the 10 channel service-quality items. Not stored anywhere: unweighted CSM values, NPS promoter/passive/detractor shares, `importance_dXX` means, domain (`dimension_*`) means, `fairness5`/`trust5`/`company_expectations5`/`price_switch5`/`grow_business5` summaries, task completion, complaint resolution, and any driver correlation, regression or relative-importance result. The brand packs store no NPS (`nps_main`) results. A drivers or relative-importance panel therefore has no answer key in these packs; Insights Elevator would need an independent fixture (for example a hand-computed Johnson relative-weights example) before claiming correctness.

## 5. Differences a recogniser must handle

| Difference | Where | Handling |
|---|---|---|
| Metadata location | BMW: `metadata.json` and `reference_results.json` at pack root; other brand packs and CSM: under `test-reference/` | Search both. |
| Codebook columns | Brand: `...mr_set, selected_value, universe, derivation, unit[, option_label]`; CSM: `...universe, mr_set, selected_value, derivation, unit`; Oldtracker: `Variable, Question / label, Type, Multiple response set, Eligible base, Value labels / missing` or a 3-column Data Dictionary | Map by header name, never by position. |
| MR sheet option column | Brand: `option_label`; CSM: `label` | Accept both. |
| Focal brand declaration | `metadata.json.client` in banking, insurance, telecoms and CSM; absent in BMW (only README, guide, chart map text and the `BMW_gap_competitor_average` metric name) | Ask when not explicit. |
| Brand code of the same organisation differs by study | FNB = 8 in the banking brand tracker, 1 in banking CSM; Capitec = 1 vs 5; Vodacom = 8 vs CSM 1 | Brand identity is study-scoped (study, variable, code). Never match across studies by code or label. |
| Overlapping brand labels across sectors | Telecoms brands "FNB Connect", "Capitec Connect", "Standard Bank Connect"; telecoms `start_channel` code 5 "Bank branch app or channel" | Bank names appearing in a telecoms frame or channel list are not bank brands. |
| Behaviour variable stems | `owner`/`bought12`/`repeat12` (BMW); `current`/`started12`/`repeat_event` (banking, insurance); `current`/`started90`/`repeat_event` (telecoms) | Use `question` (O1, O3, O4) and `metadata.json.event_stem`, not the stem. |
| Recent-start window | 12 months vs 90 days (telecoms `last_acquired` codes also differ: 1 Past 90 days, 2 91 days to 12 months) | Window comes from labels; do not compare across packs as like for like. |
| Extra modules | Banking, insurance, telecoms add S5 `category_active`, X1 products, X2/X3 experience event and resolution; telecoms adds X4 `topups30` | Optional roles. |
| Reference schema | Brand: object with `results`, brand by label, both weightings; CSM: bare array, company by code, weighted only | Two adapters. |
| Two CSM grains | Relationship (customer) vs Channel (experience; customer repeats across channels) | Never pool; deduplicate before customer measures; join on (wave, respondent_id). |
| Oldtracker coffee files | `Synthetic_Brand_Tracker_01_Primary_Brand_Only.xlsx` (attributes asked only for aware primary brand B1), `02_Fixed_Competitors` (B1-B3 only; B4-B6 not measured), `03_Rotated_Competitors` (B1 always if aware, up to two aware rivals rotated) | Attribute base is `attr_status_bX=1` (0 not asked, 1 answered, 2 DK). Blank = not asked or DK and must never become 0. Rotated rivals need `weight x attr_ipw_bX`. A brand with no measured attributes must show "not measured", not 0%. |
| Oldtracker brand registries conflict | Files 01-03: B1 Kora Coffee, B2 Metro Bean, B3 Daily Cup...; `Synthetic_Brand_Tracker_Wave_1..3.xlsx`: B1 Platō Coffee, B2 Mugg & Bean | Same code, different brands per file family. Registry must be per file set. |
| Oldtracker monthly files | `brand_tracker_Oct_2025.xlsx` etc.: wide columns named by brand (`Aware_PlatoCoffee`, `Consider_...`, `P3M_...`, `Frequent_...`), text-coded demographics, no codes or value labels | Brand and stage only recoverable from column names plus Data Dictionary; recogniser must ask for confirmation. Funnel is aware, consider, P3M, frequent (coffee), not the automotive four-stage funnel. |
| Old CSM | `CSM Tracker/Old/csm_Wave*.xlsx` (0-10 company and call-centre CSAT) | Guide forbids converting it to the five-point T2B series. |

## 6. Hardest recognition cases

1. Exclusive None flags (`aware_none`, `consider_none`, `relevant_none`, `media_none`, `attr_none_aXX`, `channel_none`) are coded `categorical` with 0/1 labels and sit next to MR members; they are outside the MR sets, and the funnel ones are filed under `question=Derived`. A recogniser keyed on 0/1 columns would wrongly add them as an option or a brand.
2. Other flags (`owner_other`, `bought12_other`, `cep_other_cXX`, `complaint_reason_r06`, `reasons_r06`) behave like brands or options but are excluded from tracked repertoires and mental market share.
3. Code 9 and 99 are variable-specific: `nps_main`/`recommend_0to10`/`switch_0to10` 99 = DK and 9 = valid score; `income` 99 = nonresponse; `opinion_bYY` 9 = no opinion (own segment); `adprompt_bYY` 9 = not sure; `experience_resolution`/`complaint_resolution` 9 = in progress; `task_completed`/`problem_resolution` 9 = pending; `callback_outcome` 9 = not yet due; CSM 98 = not applicable on performance grids. Only value labels distinguish them.
4. `first_choice` 98 merges "no first choice" and "not asked (no shortlist)"; the shortlist indicators reveal the route.
5. Attribute grid shape: 100 `attr_aXX_bYY` columns organised as one MR set per attribute with a per-brand universe. The brand axis comes from the `bYY` suffix and `aware_bYY=1` universe, the attribute axis from the MR set. DK is a per-attribute exclusive flag, and DK respondents stay at 0 in the aware base in the new packs, whereas the Oldtracker files exclude DK via blanks.
6. Per-brand single-response grids (`opinion_bYY`, `wom_bYY`, `adprompt_bYY`, `repeat_bYY`) are `categorical` with no MR set; brand identity must come from the label suffix or the shared `question` ID and position within the brand registry.
7. Lists that look like brand frames but are not: `acquisition_channel`/`start_channel`, `journey_jXX`, `media_mXX`, `product_pXX`, `primary_reason`, CSM `channel`. Lists that look like attributes but are not: `relevant_cXX` (category moments), `cep_cXX_bYY` (unprompted brand links, not image).
8. Two encodings of the same funnel stage (`first_choice` code vs `firstchoice_bYY`; `adprompt` routed vs `adrecall` all-sample; `repeat_bYY` routed vs `repeat12_bYY` all-sample) must not be double counted and use different bases.
9. CSM scales sharing codes 1-5 with different meanings (satisfaction, performance, agreement, importance, intention); "top two" is not CSAT for the non-satisfaction scales. `switch_0to10` is reversed in polarity relative to `recommend_0to10`. `price_switch5` and `grow_business5` have opposite favourable directions.
10. Universe strings are free text with several forms (`aware_b08=1`, `main_brand 1–10` with an en dash, `product_p01=1 or product_p03=1`, `problem_present=1 and problem_resolution in 1,2,3`, `Both corresponding items valid`, `Any current vehicle`). Only part of this can be parsed safely.

## 7. Questions a recogniser should ask rather than guess

1. Which brand is focal when no `client` field exists (BMW pack, Oldtracker)?
2. Weighted or unweighted display: brand references hold both; CSM references are weighted only. Which is the default for this study?
3. Association base: aware-of-brand (default in the guide) or all sample; and whether DK respondents stay in the aware base (new packs) or are excluded (Oldtracker rule).
4. Whether to treat `first_choice` 98 as "no first choice" or to split it by shortlist route.
5. Whether `opinion` 9 (no opinion) and `adprompt` 9 (not sure) should be shown as their own segments (the guides say yes) or excluded from a particular chart.
6. The switch-risk cut-off (the packs declare 8-10 as a demonstration rule, not an industry norm) and the ease threshold (6-7).
7. For CSM drivers: which target (company CSAT, NPS item or continue intention), the 98/99 treatment, and whether channel-grain drivers are wanted despite repeated customers.
8. Competitor average definition: equal-weight mean of the non-focal tracked brands (as in the packs), or a different set.
9. Whether behavioural measures (ownership/current, recent start, repeat) should be shown alongside the intention funnel and whether the recent-start window should be labelled per pack.
10. For Oldtracker-style files without codes: confirmation of the brand registry, stage meaning of `P3M` and `Frequent`, and that demographic text values are the codes.
11. For any universe the recogniser cannot parse, confirm the base expression with the researcher instead of defaulting to all respondents.

Small-base rule for all packs: flag raw n < 50, suppress inference at n < 30 (declared fixture rules). Examples: BMW recent acquirers raw n 13, 15, 24 (README); per-company Channel cells in CSM can fall below 50 (for example banking Messaging FCR raw base 74 at total level, smaller per company).

## 8. Provenance and checks performed

Files read (laptop, read-only, or staged copies in the cloud container): all four brand-pack READMEs, `metadata.json`, `reference_results.json`, `validation_results.json`, `Master_Codebook.xlsx` sheet structure, wave workbook sheet structure, BMW wave CSVs, BMW questionnaire and analysis guide, banking and telecoms questionnaires; both CSM `README.md`, `START_HERE.txt`, codebook CSVs, `metadata.json`, `reference_results.json`, relationship and channel CSVs, banking Company questionnaire and Dashboard guide; `Reference_Metrics.xlsx` / `CSM_Reference_Metrics.xlsx` summary sheets; Oldtracker workbook headers, codebooks and guides. `validate_pack.py` was not run. Each pack's existing `validation_results.json` reports `status: passed` with the limitation "Fixture integrity and reference checks, not an application or model pass."

Recomputations from the data (no files written on the laptop): BMW unweighted aware, weighted attribute association (a01, W1, BMW 36.787) and rejector share matched the JSON; the BMW gap metric equals focal minus the unweighted mean of the nine competitors; CSM CSAT T2B, NPS and switch risk (both sectors, all waves, company 0 and focal) and banking driver d06 W1 mean matched the JSON. NPS component shares in 4.3 are derived values, not quoted reference values.
