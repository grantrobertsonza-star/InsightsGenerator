# Answer domain of a categorical variable (engine contract)

Owner: `api/parse-stats-file.py` (`_non_answer_codes`, used by `crosstab` for row variables). Every
consumer of a cross-tab's answer rows (distributions and charts, CSM box and mean scores in
`csmMetrics.summarizeSeries`, NPS, findings, exports) takes the domain from the engine's table and does
not re-derive it from labels.

A variable's answer domain is the codes that are answers:

- **In:** every observed valid code, and every declared code with no cases in this sample (IMP-004: a
  scale point nobody chose is a 0% row, so a top box is never filled by the next code down and a sparse
  0-10 scale is still recognised as NPS).
- **Out:** declared user-missing codes (SPSS missing values; their cases are already missing), and, when
  non-answers are excluded (the default, `excludeDk`), codes whose label means no usable answer
  (`_DK_RE`: don't know, refused, not applicable, no answer ...). Their cases leave the base; since batch
  30 their declared code no longer comes back as a 0% row either (Codex RP0-F01: a 0% "Don't know" row,
  code 99, ranked above the scale took a top-two-box slot, giving 20% instead of 40%).
- **Included non-answers** (`excludeDk: false`): the codes are answers for that table and appear with
  their cases.

Changed behaviour: a cross-tab with non-answers excluded no longer shows a 0% row for an unchosen
declared non-answer code. Tables stored before keep their rows until rebuilt; CSM and NPS scores are
computed when asked, so they use the new domain at once.

## Run-together and joined labels (batch 47, 27 October 2026)

`_DK_RE` allows the words of a non-answer label to be run together or joined by "_" or "-" as well as
spaced, and recognises "prefer not to say" and "prefer not to answer". Before, "DontKnow",
"Not_applicable" and "NoAnswer" stayed in as answers and banner columns with non-answers excluded
(Grant: a "DontKnow" column in a UsedIVR banner, and its cases in every base). Words that only start
alike ("Donations", "Nature", "Domestic") are still answers. Tables built before carry an earlier
`methodVersion` and are marked "earlier method" until rebuilt (`claude/table-method.md`). Pinned by the
selftest's batch 47 cases (banner, row, base, included, ordinary words); the first three fail on the old
pattern.


## Driver predictors carry their answer domain (Codex T2-F01, 30 October 2026)

`driver_columns` returns, for the outcome and each predictor, `answerDomain`: `source` ("declared" when the file
has an answer list with at least one substantive code, else "observed"), `min`, `max`, `count` (number of codes)
and `integers`. A declared domain is the declared substantive codes (non-answers left out by `_non_answer_codes`)
together with every observed answer, the same In/Out rule as above; an observed domain is the answers present. It
is a summary, not a list, since a long numeric variable can have thousands of codes.

`src/lib/driverPerformance.ts` reads the driver performance measure from it (whole file, each segment, and stated
importance): every code 0 or 1 is an indicator (share); whole-number codes spanning 3 to 11 points are a scale (top
two counted down from the domain's top, and the mean), where an observed domain also needs 3 or more different
answers; anything else is a mean. Each result says `domainSource`. Before, the measure came from the answers present,
so a declared 1 to 5 scale answered only 4 and 5 was a mean and a declared 0 to 10 scale answered only 0 and 1 was
read as a 0/1 indicator with a 50% share instead of top two 0%. Pinned by the selftest's "T2-F01" checks,
`driverPerformance.test.ts` and `driverPerformanceDomain.test.ts` (actual engine, weighted, segmented, restored).
