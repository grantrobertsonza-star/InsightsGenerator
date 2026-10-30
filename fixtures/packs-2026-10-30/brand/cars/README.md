# BMW focal car brand tracking demonstration

All respondent records and named-brand results are synthetic. These are not BMW data, market-share estimates or collected survey findings. Original uploaded coffee-brand workbooks are unchanged.

## Read in this order

1. `00_BMW_Research_Brief.docx`: mock client commissioning brief.
2. `01_BMW_Questionnaire.docx`: exact questions, response types, routing, grids, randomisation and coding.
3. `Car_Brand_Tracker_Wave_1.xlsx`, `_2.xlsx`, `_3.xlsx`: 1,000 independent respondents per wave, 543 consistent variables.
4. `Master_Codebook.xlsx`: variable types, question IDs, universes, derivations, value labels, multiple-response membership, brand/situation/attribute registries and chart map.
5. `02_Analysis_and_Import_Guide.docx`: metric definitions, bases, automotive adaptation, limitations and sources.
6. `Reference_Metrics.xlsx` and `reference_results.json`: raw and weighted reference outputs, including numerators and denominators.

## Import

Select `Respondents` as the case-level sheet. Treat IDs as text. Configure the supplied relative `weight` only when weighted outputs are wanted. Match waves by raw variable and category codes. Do not import reference tables as respondent data. CSV alternatives have no embedded typing or labels; use the XLSX versions where possible. Metadata compatibility with the current app has not been tested in this session. If automatic codebook recognition needs a different schema, map the explicit supplied fields without changing their meaning.

Blank = structurally not asked. Binary zero = valid nonselection. Do not globally treat code 9 as missing. Income 99 and NPS 99 are nonresponse; opinion 9 is an intentional no-opinion response and advertising 9 is not sure. Exclusive None flags are outside substantive MR sets.

## Chart scope

The pack supplies data for all chart families shown in the screenshots: overview/performance, conversion, timeline, unfamiliar/rejectors, category moments, brand strength, moment-brand matrix/fingerprint, associations/positioning, advertising, WOM, category behaviour, demographics and media. This is an independent transparent specification, not a replication of proprietary Timelaps calculations or its coffee data.

Cars use an awareness → consideration → shortlist → first-choice funnel. Ownership, acquisition in the past 12 months and repeat acquisition are separate measures. Do not label repeat acquisition frequent buying. The category is household vehicle decision makers, not the South African adult population.

General spontaneous recall precedes CEP recall; all these precede the first named-brand list. CEP links are unprompted responses; attributes are prompted pick-any associations. The provisional automotive cues need elicitation and piloting before real fieldwork. All 12 cues are asked to every synthetic respondent, allowing direct link-breadth calculations. Interview burden has not been validated.

## Small bases

BMW recent acquirers have raw bases of 13, 15 and 24. These deliberately broad category samples do not support precise BMW buyer profiling. Reference results retain arithmetic and disclose raw bases, but the reporting specification flags n<50 and suppresses inference at n<30. A real BMW study needing stable recent-buyer profiles should cost an explicitly identified boost or larger core sample, with proper combination weights. No hidden boost or invented precision is included.

## References and validation

The Word guide includes APA-style references and accessible URLs for the Ehrenberg-Bass measurement principles and Timelaps demonstration. Relative weights are synthetic and uncalibrated. No design-based population inference, proprietary algorithm certification or application acceptance is claimed.

Run `python validate_pack.py` with existing numpy and openpyxl to check the exported files. `validation_results.json` records the completed reference checks. No installation or model call is required. `metadata.json` and the reference JSON provide a machine-readable interface for Codex. Checks validate fixture arithmetic and consistency, not the application under test.


## Measurement extension 30 October 2026

Added separate personal needs fit, perceived differentiation, perceived price justification, and ideal versus actual choice for the same most recent eligible episode. Existing data, constructs, brand codes, wave IDs and 1,000-person XLSX wave sizes are unchanged. The new synthetic items use reproducible independent random streams; they are not duplicates of value or image associations.

The episode is most recent household passenger vehicle purchase or lease in the past 12 months including new and used vehicles. The actual brand is a new same-episode response, not current provider or most-used vehicle; future first choice remains separate. Brand ratings are asked only for aware brands. Code 9 is explicit uncertainty (for price, unfamiliarity with its prices), not neutral; blanks mean not asked. Do not infer willingness to pay, pricing power, elasticity or causality.

Read 03_Claude_Dashboard_Extension_Guide.docx for additive implementation in the existing dashboard. It takes precedence over older visual plans for these new modules only. JSON is optional test/reference material, not a required mapping upload.

The existing validator now also checks the added item labels, route blanks, same-episode comparisons, CSV/XLSX agreement and all new reference metrics. Results are in extension_validation_results.json alongside the original validation_results.json.
