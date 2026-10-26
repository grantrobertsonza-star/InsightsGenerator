# Research Quality Review model fixtures (synthetic)

Synthetic documents for the semantic ("M") acceptance cases of Research Quality Review v1
(brief 2026-10-16 section 10, rubric RQC-2). Written for testing only: no real organisation,
study or person. Each case lists the documents, their roles and what an acceptable judgement
looks like in `cases.json`; `src/lib/__tests__/researchQualityModel.real.test.ts` runs them
against the real model through the budget gateway and grades meaning, not wording.
