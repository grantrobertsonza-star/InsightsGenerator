# Independent combined CSM data checks

**Result: passed.** Both sectors retain the original observations, add the approved synthetic test fields, and provide one customer record per respondent and wave. The pooled files concatenate the wave files without creating additional independent cases or changing weights.

## Coverage

| Check | Banking | Mobile telecoms |
| --- | ---: | ---: |
| Customer rows across three wave files | 3,000 | 3,000 |
| Customer rows per wave | 1,000 | 1,000 |
| Variables per combined file | 400 | 400 |
| Rows in pooled all waves file | 3,000 | 3,000 |
| Original latest used channel records reconstructed | 4,837 | 4,576 |
| Customers with no used channel across the three waves | 268 | 340 |
| Unused channel cells verified blank | 537,225 | 556,800 |
| Optional noncustomer records retained separately | 1,500 | 1,500 |
| Reference results independently recalculated | 3,306 | 2,907 |

The 400 variables consist of 100 company variables and four fixed channel blocks of 75 channel-specific variables. Thirteen context variables shared by the original company and channel tables are stored once. Every original channel row matched all thirteen fields, including interview date, company and weight, before this duplicate context was removed.

## Source preservation

- The authoritative source ZIP SHA256 is `490de8e1a87ca8fa22086fc321c65197942e02a0c6d64547360349efe7a48523`.
- All 75 extracted source files match that ZIP byte for byte. Their individual hashes are in `source_sha256_manifest.csv`.
- All 1,358,323 original company, channel and noncustomer values were compared against the reconstructed combined outputs. No original value changed.
- Customer joins use `(wave, respondent_id)`, with company and other common context validated. Original channel reconstruction additionally uses channel. Neither row position nor numeric conversion of identifiers is used.
- Text identifiers, leading zeroes, date strings, numeric codes, source weights and missing values are preserved. Optional noncustomer workbooks and questionnaires are byte-identical to their source files.
- IDs are disjoint across the supplied waves. The wave files represent repeated cross-sections, not an established respondent panel.

## Data and metadata checks

The final pass compared 6,363,324 XLSX cells with their CSV counterparts, including original source data, all combined wave and pooled data, embedded codebooks, labels and multiple-response definitions, master codebooks and reference metric workbooks.

All combined variable names are unique. Namespaced question references, prefixed routing variables, value labels and multiple-response membership resolve to valid combined fields. Unused channel blocks remain blank, while the existing company channel-use and none flags retain their explicit zeroes and ones.

Checks cover complaint routing, problem resolution, first-contact resolution, driver dimensions, call and IVR routing, staying-reason exclusivity, one anchored journey, journey dates and channel sequence, recent same-task comparator experiences, and the separate noncustomer eligibility and awareness routes. The added anger, disappointment, call, live-agent and IVR items satisfy their stated universes and scales.

Every one of the 4,143 original reference results is retained exactly. The 2,070 added results were also recalculated independently, giving 6,213 checked results. Valid bases, weighted numerators, weighted denominators and expected results all match. Codes outside a metric's valid scale are excluded rather than treated as score values or zeroes.

## Disposable boundary cases

These tests used in-memory examples and did not alter any delivered observation.

- An IVR-only call with `call_agent_contact=0`, `staff_contact=0` and `used_ivr=1` skips 16 staff or live-agent items. Eleven original call-wide or IVR items remain eligible, including the original call-history questions and total-call-time satisfaction.
- A live-agent call with a queue wait of zero still asks queue-wait satisfaction.
- Pending promise code 9 is excluded from the 1–5 mean and top-two-box calculation, alongside not applicable and do-not-know codes. It is not scored as a broken promise.

The delivered synthetic fixture retains live-agent contact for every original call because those source records already have `staff_contact=1`. The future IVR-only route is supported but is not invented as a contradictory new case in that fixture.

## Reproduction and scope

`validate_combined_pack.py` reads ordinary CSV codebooks, labels, data and reference results. Optional JSON schemas are not needed. See `README.txt` for commands and the optional XLSX and source-preservation checks. The final machine-readable result is `validation_results.json` and records 10,173,493 successful assertions.

This report verifies data integrity, metadata consistency, specified routing and reference arithmetic. It does not claim dashboard application acceptance, real-world survey validity, statistical independence of multiple channels used by the same customer, or a visual review of the questionnaires and workbooks.
