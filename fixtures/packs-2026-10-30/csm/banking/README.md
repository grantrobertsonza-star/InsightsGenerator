# Customer satisfaction tracker

This pack retains two linked current-customer data grains and adds an independent focal-noncustomer supplement for each of three waves.

- Relationship: one current customer rating one main provider. 1,000 per wave.
- Channel: the most recent experience per customer per used channel in 30 days. Not every contact and not an independent customer sample.

Read the research brief and the matching questionnaire first. Company questionnaire: 01_Company_CSM_Questionnaire.docx, matched to Relationship wave files. Channel questionnaire: 01_Channel_CSM_Questionnaire.docx, matched to Channel wave files. Each data workbook has its own matching Codebook, Labels and MR sets sheets. Original question IDs, codes, rows and values are unchanged. New question IDs and fields are appended; the extra journey module stays at respondent level. Select Respondents in Relationship workbooks and Experiences in Channel workbooks. Never import both grains as though they were the same population. Codebook, Labels and MR sets are embedded, with a separate master codebook.

Company CSAT is five-point, top two = 4–5, top = 5, bottom two = 1–2. NPS uses the original 0–10 recommendation item with passives retained in the denominator. Ease is seven-point, higher = easier. Higher switching likelihood means worse risk. These definitions are not interchangeable.

Blank = structural skip. 98 = not applicable on performance items. 99 = do not know or prefer not to say as labelled. Pending = 9 on selected status questions and must not be globally converted to missing. Always use each question's own valid base.

Channel records inherit the same customer weight. Within one channel there is at most one record per person. Across channels the same person can appear repeatedly. Deduplicate customer measures before joining/aggregating. Join only within this study and sector using wave and respondent_id, never row position. Other synthetic projects may reuse a superficially similar ID pattern.

The source ZIP is unchanged. This expanded copy retains the original data fields and adds the requested modules. The older 0–10 CSM data are not converted to the new five-point measure. The uploaded Word document is a general questionnaire template, not a specific original CSM scale. The new performance-only domains are SERVQUAL-inspired, not certified original SERVQUAL or ACSI scores.

All data, brand effects and verbatim examples are fictional. Fixed company allocations are not market shares. Stated loyalty and switching are intentions, not observed churn or retention. No client records or personal identifiers are included.

The optional Reference Metrics workbook and test-reference folder provide calculation answer keys for Codex. Do not import them as respondent records. To validate unpacked data, run python test-reference/validate_pack.py . using existing numpy and openpyxl. No application acceptance is claimed until the app's actual outputs are compared.

See 02_Dashboard_and_Analysis_Guide.docx for dashboard views, filters, bases, low-base rules, service-quality routes and measurement references.


## Additive expansion dated 30 October 2026

- Relationship data adds experience-led preference and multiple/primary reasons for current use, distinguishing preference, habit, contractual restriction, switching inconvenience and lack of alternatives.
- Journey fields describe one independently anchored task started or attempted in 30 days. They capture ordered channel contacts, app/website mode, transfers, repeated information, end-to-end outcome, emotions and preference. They are not reconstructed by joining separate latest-channel experiences.
- Channel data adds four separately rated emotional outcomes, a reason verbatim and experience-led preference on each existing experience row.
- Competitive ratings require personally experienced alternative use of the same task type within 30 days. Paired CSAT differences use only respondents with two valid ratings. Missing or noncomparable evidence is Not measured, not zero.
- The new Noncustomer workbooks contain 500 independent synthetic focal-provider noncustomers per wave. They use the sector but have no current focal use, including secondary use. Focal awareness gates consideration and anticipated performance. They never rate unexperienced focal service. Unit-weight, approximately balanced alternative-provider quotas are a demonstration design, not population targets.
- Keep noncustomer expectations and customer performance as separate profiles: future expectations versus retrospective experience are not a paired gap. Never pool the samples for prevalence or market share.

Read 01_Noncustomer_Expectations_Questionnaire.docx and 03_Claude_Implementation_Instructions.docx. The Claude instructions are written handoff only: retain the existing app font/layout and #2563eb accent. No app changes or communication with Claude took place.

Select only Respondents, Experiences or Noncustomers for import. Embedded metadata is sufficient. JSON/CSV under test-reference and the reference workbook are optional validation aids and are never required app imports. The validator now tests all three grains, original and added routes, reference arithmetic, and XLSX/CSV parity.
