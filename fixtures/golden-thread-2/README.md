# Golden thread2: weighting-only reference fixture

Prepared independently before application execution. One distinct120-person synthetic dataset extends the supplemental pack's verified02_weighted component. Original respondent IDs,weights,purchase and rating values are unchanged;added MR/pilot fields are deterministic synthetic extensions. This is not another copy of golden thread1. All files here and the supplemental component share one dataset identity and are not independent corroboration.

## Inputs and orientation

Primary input:columns-as-cases.xlsx,Cases sheet,explicit columns_are_cases layout. Case headers0001..0120 remain strings;first column lists canonical variables. Codebook is a separate row-per-variable sheet with explicit value labels and MR set membership. columns-as-cases.csv is a matching orientation control;data-control.csv is canonical rows-as-cases for independent references. Do not upload control and primary as separate corroborating datasets;use separate disposable clones for any orientation comparison.

questionnaire.txt,client-brief.txt and report.txt are synthetic UTF-8 inputs. Report C1 is correct weighted purchase65%;C2 plants7.5 instead of6.5;C3 is compatible precision caution;C4 requests unavailable cluster-robust inference;C5 overstates an eight-person subgroup. Semantic outcomes are in expected.json,not exact model prose. No DOCX/PDF conversion dependency is introduced.

## Weight,base and missing contract

Weights1/3 are positive relative calibration weights,not frequency replication. Weighting alone is not a complete sampling design. Raw n120,weighted total240,Kish effective n96. Multiply all weights by7:weighted total1680,point estimates/effective base unchanged. Weighted percentage is100?sum(w?indicator)/sum(w);weighted mean is sum(w?x)/sum(w). Raw purchase50% and mean5 are controls,not weighted answers65%/6.5.

Last four respondents have entirely missing MR sets;exclude them from valid MR bases rather than turning blanks into unselected. MR valid raw116,weighted228,effective92.17021276595744. Each option denominator is eligible respondents,not selection totals;Service has declared code1 but zero selections. Pilot n8,weighted8,effective8 cannot support unqualified population certainty. Follow the existing documented warning/suppression policy;this fixture invents no universal engine cutoff.

Rating uses1-10,higher is better. Request/save the supported continuous override and verify weighted mean6.5 after reload. If initial inference is already continuous,explicitly save discrete then continuous to exercise correction semantics;do not invent an initial inference defect. Clearing must visibly restore actual file inference.

## Inference and tolerances

Kish-Wald95 interval and unpooled group-normal significance references are explicitly conditional on that selected method. No PSU,strata,cluster-robust or complete-design result is expected. Match a documented supported alternative method rather than flagging a valid difference automatically. Relative derivation/population claims remain qualified. All tolerances are absolute and unit-tagged:percent0.1point,mean0.01scale point,arithmetic base/inference references1e-9. Compare unrounded values. Expected rounding:percent1decimal,mean2decimals;display rounding does not alter the formula.

## Status and reproducibility

15 numerical/base assertions and downstream requirements are predeclared. Command:python scripts/golden-thread-hardening/build-thread2.py. Builder refuses to overwrite an already frozen expected.json. Reference checks use standard-library arithmetic and installed openpyxl3.1.5,not application analytical functions. No application pass,model judgement or native compatibility is established. Actual stages remain not run until the stable source/harness/interface and secure-key prerequisites are available. No fixture files or code from the attached pack were executed.
