# CSM additive expansion 30 October 2026

## What changed

Both sectors retain all original current-customer and channel records, fields, codes and values. Forty-one relationship fields and six channel fields were appended. Questionnaires insert the additions at the relevant points rather than replacing the original instruments. Research briefs, dashboard guides, embedded metadata, master codebooks, CSV fixtures, optional JSON, metrics, validators and manifests are updated.

Each sector adds three independent supplemental noncustomer workbooks with 500 synthetic records each and a matching questionnaire. Noncustomer means no current use of the focal provider, not no use of the sector. Existing brands and allocation counts were not changed. New instructions give Claude a written implementation specification while preserving the app font, layout and #2563eb accent; no app changes or contact occurred.

## Measurement issues addressed

The old latest-experience-per-channel rows did not identify one continuous task. Joining them as a journey would have been a significant interpretation error. The expansion uses an independent respondent-level task anchor with its own ordered contacts and outcome, without rewriting the old channel records.

The existing customer sample could not provide an independent focal-noncustomer expectations sample. A clearly separate synthetic supplement is supplied, not a relabelling of existing customer rows. It must not be pooled for prevalence or market-share estimates.

Alternative ratings now require personal recent use and comparable task type and period. Unavailable evidence remains Not measured. Experience, emotion, stated preference and reasons for continued use remain distinct constructs. No causal drivers, ROI, observed churn, market rankings or validated composite emotional scores are inferred.

## Synthetic design and limitations

The additions are deterministic synthetic fixtures, not new real-world research. Independent waves do not track individual change. Retention reasons can coexist. A paired competitor difference is descriptive and may reflect selection and task complexity. Expected future service and retrospective performance have different samples and time referents; the pack specifies separate profiles rather than a manufactured expectations gap.

## Verification

The source ZIP was retained. Exact old-cell preservation, embedded metadata coverage, route logic, CSV parity and independent reference arithmetic are checked in preservation_report.json and each sector test-reference/validation_results.json. Visual checks cover edited documents and spreadsheet ranges; fixture validation is not app acceptance. See QA_REPORT.md for the completed checks and any residual limitations.
