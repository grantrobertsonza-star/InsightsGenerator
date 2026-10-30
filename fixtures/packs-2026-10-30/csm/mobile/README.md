# South African mobile telecoms separate testing pack

## Purpose

South African mobile telecoms separate company and channel synthetic testing base. Fictional records, not actual market evidence.

## Representations

Choose this separate pack OR the combined pack. They encode the same customer answers. Never append or union the two representations.

## Company grain

Relationship Respondents contains one person per (wave, respondent_id), 100 fields; 1,000 per wave and 3,000 in All_Waves.

## Channel grain

Channel Experiences contains one latest experience per used channel and (wave, respondent_id), 88 fields. Up to four rows per person; these are not extra customers or every recalled contact.

## Keys

Keep respondent_id and experience_id as text, retaining leading zeros. Join channel records many-to-one to company records on (wave, respondent_id), and verify company plus all 13 shared values. Channel key is (wave, respondent_id, channel).

## Import choice

For each grain import three Wave files OR the All_Waves file, never both. Matching CSVs are in test-reference. No JSON or hand-written mapping is required.

## Weights

Use the supplied positive weight once per person for company or anchored-journey results; once per eligible experience for a channel-specific result. Never calculate company KPIs on multiplied channel rows.

## Waves

February, June and October 2026 are repeated synthetic cross-sections, not a panel. Preserve wave and weights. Default reporting to one wave; pooled estimates are descriptive only.

## Routing

Only used-channel rows exist. In each row, routed-out fields stay blank. Preserve 0 as a valid No or nonselection. Codes 98 and 99 are scale-specific exclusions, not zeros.

## Emotions

Reassured, valued, frustrated, anxious, angry and disappointed are separate 1–5 intensities; higher negative emotion is worse. Keep whole-task and latest-channel emotions distinct; never invent a net emotion score.

## Call diagnostics

Call agent, queue, total duration satisfaction, agent performance, transfer, promise and urgency diagnostics are separately routed. IVR ratings require used_ivr=1. Original process variables remain intact.

## Pending

agent_promises_kept5=9 means not yet due or too early to tell. Exclude 9 from valid 1–5 ratings; do not classify pending as broken promises. Pending task and callback statuses retain their own meaning.

## Future IVR-only calls

All preserved call rows already had staff_contact=1, so call_agent_contact=1. Questionnaire skip routes cover future IVR-only calls; none were fabricated by changing baseline answers.

## Independent journeys

The company journey is one independently anchored task. Latest call, branch/store, digital and chat experiences can concern different tasks; never stitch them into one journey.

## Dependence

A person may contribute multiple channels. Cross-channel inference must account for within-person dependence. Do not treat pooled channel rows as unique-person sample size.

## Optional noncustomers

The unchanged 500-case per-wave noncustomer files and questionnaire form a separate optional supplement. Never append to customer or channel bases.

## Testing references

CSM_Reference_Metrics.xlsx and test-reference/Reference_Metrics.csv contain static acceptance-test targets, not live recalculating reports. validate_pack.py independently checks the exported data.

## Source

Projected and unpivoted from the frozen combined 400-field files. All baseline company and channel values are preserved; new diagnostic and emotion responses exactly match the combined representation.
