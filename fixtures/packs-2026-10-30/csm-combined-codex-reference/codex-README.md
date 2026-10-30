# Independent combined CSM reference values

Read-only analysis of Grant's updated Banking and Telecoms combined testing base. All authored files are confined to this work directory. No app code or pack calculation scripts are imported.

`csm-reference-values.json` contains weighted and unweighted estimates, eligible and valid raw, weighted and Kish bases, full distributions, NPS components, satisfaction means/top two, continuing use and switching risk. Results cover all three waves separately, each company and all companies, and each channel on its own channel-user base. Additional pooled rows are labelled pooled independent cross-sections, never a panel or a new single-period population. There are 540 result rows across both sectors.

The scope inventory contains 37 fields per sector, including complaint, whole-task and benchmark satisfaction and structural channel diagnostic fields. Each states the question, scope, declared scale, route, evidence files and populated counts per wave. Channel-specific NPS, continuing-use and switching questions are absent. Company-wide responses are not copied into channel outcomes.

All 1,260 relevant pack-reference comparisons match at absolute tolerance 0.000001, with raw counts exact; the largest absolute value difference is 2.85e-14. No material differences were found. These checks cover the requested core variables, not every pack reference. All data are synthetic.

Reproduce with the supplied Python environment containing pandas, numpy and openpyxl:

1. `python compute_reference.py`
2. `python verify_reference.py`

The first script calculates from ordinary respondent CSVs and documented questionnaire/codebook definitions, then compares the independent results to reference rows. The second checks all-waves XLSX parity, original text identifiers, codebook/label parity and arithmetic reconciliations. `summary.json`, `source-checks.json`, source hashes and extracted questionnaire/analysis-guide text retain the evidence. Original source wording is preserved in the JSON.

Weights are unchanged relative customer weights, never expansion weights. Channel users overlap; no independent-sample inference is performed. Missing/routed answers never become zero, and valid recommendation/switching zero is retained. Five-point top two is 4 or 5; NPS retains passives in the denominator; switching risk 8 to 10 follows the declared fixture rule and is an intention, not observed churn.
