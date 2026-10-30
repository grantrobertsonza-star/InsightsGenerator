# South African personal banking synthetic tracker

Focal brand: FNB. All named-brand results are fictional test data, not real company or population estimates.

## Main research files

1. 00_Research_Brief.docx: mock research-manager invitation to agencies.
2. 01_Questionnaire.docx: exact questions, order, routes, response types and randomisation.
3. Bank_Brand_Tracker_Wave_1.xlsx, Wave_2.xlsx and Wave_3.xlsx: three independent samples of 1,000 respondents, each with 550 consistent variables, Codebook, Labels and MR sets.
4. Master_Codebook.xlsx: variable definitions, values, raw brand codes, MR groups and chart map.
5. 02_Analysis_and_Import_Guide.docx: definitions and denominators for every chart family.

Import only Respondents as the case-level worksheet. Preserve text IDs and raw codes. Use the weight variable only when requesting weighted results. The synthetic relative weights are not externally calibrated. No native app import was executed in this session. If the importer needs another metadata layout, adapt the explicit fields without changing their meanings.

## Scope

Adults aged 18–69 who currently hold a personal bank account or expect to open one in the next 12 months. Exclude business-only accounts. Include multi-banked customers and intended first-time entrants.

FNB and RMB are not separate consumer brands in this fixture. GoTyme Bank and TymeBank use one stable entity code; the combined alias is held constant across synthetic waves. A real rebrand requires separate name-awareness measures and a comparability bridge.

The funnel is awareness → consideration → shortlist → first choice. Current relationships (current_bXX) and recent starts (started12_bXX) are separate, non-nested behavioural measures. Repeat-event flags are recent starts with prior same-brand experience, not frequency or general loyalty.

General spontaneous awareness and cue-specific recall occur before named-brand prompts. Brand image is a later pick-any task. Category-entry-point wording is provisional and requires elicitation and piloting before real deployment.

## Optional checking material

Reference_Metrics.xlsx and the test-reference folder are for Codex/system testing. They are not extra survey inputs. Expected results include numerator, denominator, base and weighting so app results can be checked against known answers. JSON lets automated tests read the same answer key. CSV is a fallback raw format, not required when using Excel. These references validate fixtures, not the app until a comparison is actually run.

In the ZIP, the validator, metadata and reference JSON sit together under test-reference. To run validation, pass the research folder as an argument: python test-reference/validate_pack.py .

## Coding and reporting

Blank means structurally not asked, while 0 means an observed binary nonselection. Income 99 and NPS 99 are explicit nonresponse. Code 9 is substantive for opinion, advertising and resolution. Never apply a global missing-code rule. Exclusive None fields are outside substantive MR sets.

Flag raw n below 50 and suppress inference below 30. Small competitor/customer bases remain in the reference arithmetic with their bases disclosed. Kish effective base is supplied, but no PSU/strata or design-based inference is claimed. Profiles are conditional on the labelled main-provider or recent-starter universe. Percentages across multi-provider brands do not sum to an exclusive market share.

Planted changes are simulation assumptions only. A positive trend for FNB or a negative WOM shift for a competitor does not assert anything about real performance or campaigns. No account, policy, vehicle registration, name or phone number is generated.

The consolidated first_choice field uses 98 for no shortlist as well as no stated first choice. Shortlist indicators retain the asked route. This exception is explicit, rather than treating every unasked single-response field as observed.


## Measurement extension 30 October 2026

Added separate personal needs fit, perceived differentiation, perceived price justification, and ideal versus actual choice for the same most recent eligible episode. Existing data, constructs, brand codes, wave IDs and 1,000-person XLSX wave sizes are unchanged. The new synthetic items use reproducible independent random streams; they are not duplicates of value or image associations.

The episode is most recent personal bank account opening in the past 12 months. The actual brand is a new same-episode response, not current provider or most-used vehicle; future first choice remains separate. Brand ratings are asked only for aware brands. Code 9 is explicit uncertainty (for price, unfamiliarity with its prices), not neutral; blanks mean not asked. Do not infer willingness to pay, pricing power, elasticity or causality.

Read 03_Claude_Dashboard_Extension_Guide.docx for additive implementation in the existing dashboard. It takes precedence over older visual plans for these new modules only. JSON is optional test/reference material, not a required mapping upload.

Source repair: wave 2 CSV originally held 371 rows. Its 629 missing rows were restored from the intact original 1,000-row XLSX after confirming every overlapping cell matched. No synthetic respondents were added.

The existing validator now also checks the added item labels, route blanks, same-episode comparisons, CSV/XLSX agreement and all new reference metrics. Results are in extension_validation_results.json alongside the original validation_results.json.
