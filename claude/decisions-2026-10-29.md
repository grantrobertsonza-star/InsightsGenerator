# Decisions recorded 29 October 2026 (Grant)

All accepted as recommended ("Ok, i will go with your recommendation"; "Ok, accept all").

## Dashboards (D2)
- Dashboard settings saved per programme ("Ok, lets start with programme"); a project in no programme keeps its own.
- Weighted by default when the file has a weight.
- Inputs are mostly raw files (SPSS, Excel, text, R, Python); JSON codebooks such as the packs' metadata.json are unlikely.
- Indicator Analytics (D6): the single-indicator design (Unified_Indicators_Visual_Plan) and the multi-indicator design (Multi_Indicator_Dashboard_Visual_Plan, "the target design for multiple indicators").

## Exports
- Superseded and not-reproduced tags appear on Word, Slides and Excel exports (findings recalculated after a researcher acted on them). Next batch that touches exports.

## Batch 62 capture and selection contract: accepted
Every route that turns a source into findings records what was captured (whole or part), what was examined, and which
rule or cap decided what was kept; "captured in full / in part / failed" is reported apart from "nothing found /
capped". Per route: reports (parts sent, answered, failed; recall not yet measured); summary tables (columns examined
and omitted with reasons, test and correction, cap); Cross tabs (request, significance rule and caps, cap notice);
banner plans (plan version, stale on change); scatter and driver analysis (cases used of cases, weight, variables);
coded transcripts (coded vs uncoded segments, codes not made findings and why); wave comparison (waves and variables
compared, omissions). Built route by route as each is next touched.

## Import test library: all 12 accepted (claude/import-test-library-findings-2026-10-28.md)
1. Agency banner tables read as they come. 2. A 0 to 1 value whose format or label says % is a percentage, conversion
stated. 3. Tests use the unweighted (or effective) base; percentages weighted. 4. Pattern scan off for aggregated
tables. 5. "NA" stays missing; warn in a column of short codes. 6. Blank text answers are no answer in every format,
including SPSS and Stata. 7. "Not sure" is a non-answer; "Don't know which ..." naming its subject stays an answer.
8. Range codebook cells label both end points. 9. Title rows above an Excel header detected; header row changeable on
the Import screen. 10. A report's own tables stored to check its claims (after batch 57). 11. Word/PDF uploaded as
Tables still accepted, failures fixed. 12. "-" is 0 and "*" is under 0.5%, stated.
These govern batches 55 to 57.

## Security (noted for later)
See `claude/backlog-security-and-soc2-2026-10-29.md`. No SOC 2, enterprise-control or regional-hosting claim is
published until established.
