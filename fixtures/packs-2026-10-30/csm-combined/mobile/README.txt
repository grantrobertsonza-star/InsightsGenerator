Telecommunications combined CSM testing base

Start with
  00_Combined_CSM_Research_Brief.docx
  01_Combined_CSM_Questionnaire.docx
  Master_Combined_CSM_Codebook.xlsx

Main customer data in data/
  Mobile_CSM_Combined_Wave_1.xlsx and .csv
  Mobile_CSM_Combined_Wave_2.xlsx and .csv
  Mobile_CSM_Combined_Wave_3.xlsx and .csv
  Mobile_CSM_Combined_All_Waves.xlsx and .csv

Analysis and written implementation handoff
  02_Combined_Dashboard_and_Analysis_Guide.docx
  03_Claude_Combined_Implementation_Instructions.docx
  CSM_Combined_Reference_Metrics.xlsx

This is the updated combined testing base. Company and channel measurement now share ONE routed questionnaire and ONE respondent-level dataset. Each current customer appears once per wave, with company answers and all relevant channel answers on the same row.

All observations, verbatims and apparent brand effects are synthetic demonstrations. The original separated packs have not been modified. The 98 original company fields and all 71 original channel fields are preserved losslessly, with 13 identical shared fields represented once rather than repeated. Two new whole-journey emotion fields and 17 new channel fields are seeded synthetic additions approved for this testing base.

The combined dataset has 400 columns: 100 company and whole-journey fields, followed by four 75-field channel blocks. Each ch01_, ch02_, ch03_ and ch04_ block describes the latest experience in the last 30 days with that used channel, not every contact. Channel prefixes mean call centre, branch or shop, digital self service, and messaging or live chat. Retain app versus website digital mode. An unused channel block is blank, not zero. Existing explicit use and none flags remain intact.

Satisfaction remains five-point. Recommendation for NPS remains 0–10. Switching likelihood is a direct 0–10 likelihood question for the next 12 months, not agreement with seldom thinking of switching. Ease retains its source seven-point scale. These constructs and scale definitions are not interchangeable. Angry and disappointed join reassured, valued, frustrated and anxious as six separately analysed intensities; do not create an unvalidated net-emotion score.

New call-centre diagnostics distinguish live-agent contact, queue-wait satisfaction, total-call-time satisfaction, overall-agent satisfaction, correct person on first transfer, ownership, promises, patience and response to an explicitly urgent need. IVR availability, response speed, information accuracy and ease are performance ratings for IVR users, not satisfaction ratings. Existing IVR clarity is retained without a duplicate. Promise ratings code 9 means not yet due or too early, never a failed promise. Original call-centre records already contain positive staff-contact facts and staff answers, so their new live-agent screen is Yes. Future IVR-only skip routes are documented; original answers have not been changed to fabricate such cases.

The one anchored whole journey is independent of the latest-channel blocks. Never reconstruct that journey by linking the four channel experiences. Channel comparisons can include the same person multiple times and therefore need paired or respondent-clustered inference. Do not use unqualified independent-sample tests or treat channel records as extra customers.

Import EITHER the three individual wave files OR the single All_Waves pooled file, never both, because they contain the same cases. Likewise choose EITHER the combined representation OR the separate company/channel representation for an analysis, never both. Import only the Respondents sheet from a combined XLSX, or its matching CSV. The questionnaire, embedded Codebook and Labels sheets, and Master_Combined_CSM_Codebook.xlsx are ordinary research inputs sufficient for import. No JSON or hand-written mapping is required. CSV imports must preserve respondent and experience identifiers as text, including leading zeros. Read reference and metadata files as documentation or validation fixtures, not respondent rows.

Each wave has 1,000 customers. Combined_All_Waves is the exact 3,000-row concatenation of the three wave files, retaining wave, interview date, text identifiers and source weights. The samples are independent repeated cross-sections, not a panel. Default reporting selects a wave. Unchanged weights total approximately 1,000 per wave and 3,000 pooled, subject only to original decimal rounding. Do not silently recalibrate pooled weights. Any pooled estimate is descriptive of these three synthetic samples, not a calibrated single-period population.

The supplemental_noncustomers folder is OPTIONAL and separate. It contains the unchanged 500-case noncustomer sample and questionnaire per wave. These are not additional customer rows and must never enter customer, channel, NPS or journey denominators. Do not mix anticipation among noncustomers with experienced customer performance as a paired gap.

Reference metrics are static numerical answer keys, not live dashboard outputs. They retain the original results and add eligible-base results for the new fields. Pooled channel reference rows (channel = 0) describe latest-channel experiences, not unique customers or whole journeys. Negative-emotion top-two-box is high intensity, not a favourable outcome. Show raw valid and weighted bases and the universe beside every metric.
