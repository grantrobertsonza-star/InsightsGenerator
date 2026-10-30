Banking and telecoms separate CSM testing base
Updated 30 October 2026

This pack keeps company and channel questionnaires and data separate. It contains the SAME measures and customer answers as the updated combined testing pack, not another sample.

1. Choose banking or mobile. Read its research brief, company questionnaire and channel questionnaire.
2. Use Master_CSM_Codebook.xlsx plus embedded Codebook, Labels and MR sets tabs. JSON files are optional QA aids, never import requirements.
3. COMPANY data: import Respondents from the three Relationship_Wave files OR Relationship_All_Waves. Each wave has 1,000 customers and 100 fields; pooled has 3,000 rows.
4. CHANNEL data: import Experiences from the three Channel_Wave files OR Channel_All_Waves. Each row is the latest experience of one used channel, with 88 fields. Pooled rows: banking 4,837; mobile 4,576. These are not unique-person sample sizes.
5. Join the two grains on (wave, respondent_id), keeping IDs as text. Verify company and the 13 shared fields. Never calculate company KPIs on repeated channel rows.
6. Choose SEPARATE OR COMBINED format, never both. Choose WAVE OR POOLED files for each grain, never both. CSV equivalents in test-reference are copies, not extra records.
7. Use the dashboard guide and 03_Claude_Implementation_Instructions.docx for a later authorised implementation. No app change, deployment or Claude contact is part of this file delivery.

The approved additions are angry and disappointed at anchored-journey and latest-channel level, plus fuller routed call-centre and IVR diagnostics. All original fields and answers remain unchanged. New fields were projected/unpivoted from frozen combined data, not regenerated, so both formats reconcile exactly.

Optional Noncustomer questionnaires and three 500-row wave files remain separate and unchanged. Never append them to customer or channel denominators.

All responses and patterns are fictional synthetic test data. Three waves are repeated cross-sections, not a panel. Keep original weights, valid bases, blanks, pending codes and scale-specific nonresponse. Do not treat pending promises as broken promises or negative emotions as favourable satisfaction.

Validation
  python validate_separate_pack.py
  python validate_separate_pack.py --xlsx

CSV validation uses the Python standard library. --xlsx additionally requires openpyxl for read-only verification. Validation tests files and reference arithmetic, not an actual dashboard import. See QA_REPORT.md, preservation_report.json and quality_checks/validation_results.json.
