# CSM verification results

The final banking and mobile expansion preserves every original data value and passes the checks below. It is a synthetic research fixture, not an application acceptance test or a finding about the named providers.

## Original records and values

Banking retains 3,000 relationship records and 4,837 channel records. Mobile retains 3,000 relationship records and 4,576 channel records. No original fields, codes, rows or values were removed or recoded. All 1,022,586 addressed cells in the original used ranges of 16 workbooks, including structural blanks and text identifiers, were compared after final export. Original reference-result records are unchanged. See preservation_report.json.

The expansion adds 41 relationship fields, 6 channel fields and a separate 1,500 synthetic focal-noncustomer records per sector, split 500 per wave. These samples must remain separate.

## Data and metadata checks

Both sector validators pass. Banking has 2,202 reference statistics; mobile has 1,941. All values, weighted numerators, valid weighted bases and raw bases are recalculated independently with NumPy from exported XLSX. A separate reviewer independently recomputed all 228 newly added metrics directly from CSV, with 912 scalar checks; every raw base matched exactly and the maximum numerical difference was 0.0000000000001. All CSV records match their XLSX counterparts. The 1,218 embedded variable definitions across the 18 data workbooks agree with master, CSV and optional JSON metadata.

Routes checked include current-customer joins, latest-channel eligibility, original service-quality skips, complaint routes, independently anchored journey sequence and contact capacity, selected-channel consistency, recency/date order, pending-outcome exclusion, staying-reason exclusivity and primary selection, personally used alternative provider/task/window checks, paired comparison bases, focal noncustomer exclusion and awareness/actual-alternative-use skips. Separate reviewers also checked original data preservation and these added routes.

Original native table names are retained and their affected ranges extended. No original chart, pivot or external-link objects were dropped. The existing workbooks contain fixed synthetic data/reference values rather than input-driven analytical formulas.

## Visual and content checks

An independent reviewer inspected every page of all 12 final Word documents: 42 pages total. Each sector has a one-page brief, six-page company questionnaire, four-page channel questionnaire, three-page noncustomer questionnaire, four-page dashboard guide and three-page Claude implementation instructions. There are no unresolved clipping, pagination or table issues.

Spreadsheet previews cover changed data, metadata and reference ranges and every sheet in the new workbooks. New long verbatims have fitted readable columns. Added question sub-IDs map to their codebook fields. Banking and mobile display terminology is appropriate to the sector.

## Limits and handoff

The optional JSON and CSV fixtures are not required for normal app import. Only Respondents, Experiences and Noncustomers are case data. These checks do not show that any application implements the expanded design correctly. Compare actual app outputs and preserve its existing font, layout and #2563eb accent before claiming app acceptance. No app, Claude session, production system or real respondent was contacted or changed.
