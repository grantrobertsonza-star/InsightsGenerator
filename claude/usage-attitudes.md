# Usage and attitudes dashboard contract

Rule version: ua-2026-10-30-1. This is a descriptive dashboard over independent survey cross-sections. It does not infer longitudinal change, churn, population facts or causal effects.

## Recognition and source identity

`uaRoles.ts` owns semantic role recognition. The signature requires at least two confirmed category-ever consumption, consumption recency or personal P3M purchase roles, plus attitude or recent-episode coverage. Numeric occasions, spend and whole coverage areas may be absent. Ambiguous evidence that could establish the signature exposes a mapping tile; it is never hidden as if the study were unrelated. BMW and company CSM structures alone do not satisfy it. Multiple candidates become a mapping question. Question IDs join declared workbook tables; physical variable prefixes are never interpreted as questionnaire numbers. The generic relational reader joins variables, rules, questions and code lists by their declared identifiers and refuses missing or duplicate joins. Confirmed codebook text supplies administrative weight descriptions as well as question text.

`uaRouting.ts` owns compilation of declared eligibility and assignment rules into raw-code conditions. Every referenced question must resolve uniquely. Answered-state codes come from the confirmed state field's labels. Unsupported routing refuses the affected measure. The questionnaire is optional when the codebook already states wording, options and routes. It cannot silently override a researcher-confirmed codebook mapping.

## Metric contracts

`uaMetrics.ts` produces the inspectable requests in `ua-metric-contracts.json`. Each entry records its source variable and printed question, page, selection codes, period, eligibility, assignment, answered-state condition, explicit zero condition and weight override. This is the per-measure contract; it contains no QA expected values.

For every entry let A be assignment, E be routing eligibility intersected with A, and V be E with an answered state and a finite recorded value. A known same-period non-use may enter V with zero only when the request explicitly supplies `logicalZero`. Unknown, refused, not shown and inapplicable states otherwise never enter V. Repertoire requires answered states and finite values for every declared member. Basket comparison requires answered values for both recalled baskets.

| Kind | Numerator | Denominator and output |
|---|---|---|
| percent | sum of analysis weights for selected raw codes in V | sum of analysis weights in V; numerator / denominator times 100 |
| mean | sum of analysis weight times recorded amount in V | sum of analysis weights in V; numerator / denominator |
| sum | sum of expansion weight times recorded amount in V | no ratio; output is the numerator, with V still reported |
| hypothetical people | sum of expansion weights for selected codes in V | numerator shown as fictional people, not a percentage |
| verbatim | source responses with answered states and nonempty text in E | raw response count and first six eligible source texts in file order; not a thematic estimate or representative sample |

Every result carries assigned, eligible and valid raw count, weighted base and Kish effective base `(sum w)^2 / sum(w^2)`. The engine's own `base_stats`, ordinary Cross tab percentages and means remain authoritative. The bridge creates temporary measures only, passes the resolved survey design, and never saves these as ordinary tables or findings. `buildCrosstab` refuses a dashboard batch request.

Small-base estimates and verbatim samples obey the existing engine minimum raw base. A displayed figure below the engine's separate reliability threshold is labelled Indicative only. Their values and weighted numerators are unavailable, with the bases and reason retained. This first version accepts numeric raw-coded questions and numeric amounts, plus the explicit verbatim method. Text-coded or logical-coded questions and numerically ambiguous code lists refuse with a mapping reason. Missing weights, nonpositive or nonfinite weights, missing route variables, incomplete replies and failed storage reads refuse the calculation. An empty result is not substituted after failure.

## Page definitions

1. Footprint: lifetime and stated P12M/P3M consumption, personal purchase, never and lapsed; fictional people, litres and answered-buyer spend within one wave only. Expansion weights remain separate from analysis weights, including when the researcher requests unweighted descriptive shares.
2. Repertoire: P3M consumption and purchase incidence, including unbranded and unknown. Confirmed same-window non-use supplies the only population-incidence zeros. Named-brand repertoire counts each named brand once and excludes unbranded and unknown identities. Numeric means include answering eligible users or buyers only. Shopping trips can overlap across brands.
3. Occasions: the most recent episode's context and goals. No share of all market occasions is claimed.
4. Needs: stated agreement top two, goal fulfilment and the recent episode's sugar variant. Scale boxes use declared labels, never observed maximum codes.
5. Memory: top of mind, any coded spontaneous mention once per person, prompted awareness, assigned association modules, situation-cued recall and original open associations. Split assignment is applied before aware eligibility and answered-state selection. No new thematic categories are invented.
6. Choice: consideration and first choice remain intentions. Barriers use their declared audiences and routes. Unknowns are not selected No responses.
7. Experience: reported brand experiences, eligible-user satisfaction, verified P3M-buyer repurchase intention, and differences between recalled consecutive baskets. These are not measured churn. Outside-category alternatives remain outside the category universe.
8. Future: use and purchase intent are separate. Outstanding postponed purchases use their stated status and explicit non-postponement zeros; hypothetical first-choice substitutions remain separate from reported behaviour.
9. Audiences: confirmed non-users, lapsed users and buyers. A light-user boundary must be chosen by the researcher because the study does not define one. Audience barriers retain the answered-state condition.

## Choices, concurrency and freshness

Migration 0140 creates tenant-owned project or programme choices with one scope per row and an increasing revision. Save checks project and child ownership before reading, then rechecks active ownership and scope under a project/document lock in the writing transaction. Programme writes also bind tenant and programme ownership. Revision compare-and-swap and first-row uniqueness refuse losing concurrent writes. A moved project does not silently write to its old scope. Missing migration permits computation and refuses saving with the reason. Unchanged mappings absent from another wave are retained and reported inapplicable.

Figures are computed on read from current metadata. No derived table or finding is persisted. Human mappings are never silently rewritten by role recognition. Saved appears only after acknowledgement; reloading the saved workspace applies its mapping before the page is recomputed. Late page or document replies are ignored after cleanup. Keyboard focus stays in the dashboard and Escape closes it.

Wave comparison uses the immediately previous included file in the shared wave ordering. A comparable percentage needs the same variable, method, raw codes, unit, routing, assignment and label identity. Differences use full-precision values. Failed or incomparable prior measures remain unavailable. These are independent cross-sections, with no significance claim.

## Deferred integration

`withUaSegment` is the explicit raw-code segment hook. The UI states that segment integration is pending. `uaWaveDifference` is the descriptive difference hook for the later shared significance integration. No unrelated tracker owner or existing dashboard screen is changed.

## Runtime packaging

The internal Python modules live in `scripts/engine/`, with the existing HTTP handler in `api/parse-stats-file.py`. This avoids declaring helper files as additional API functions. The Python runtime includes project files by default; a deployment that adds exclusions must retain `scripts/engine/`. No deployment is performed by this branch. Reference: [Vercel Python runtime and bundled files](https://vercel.com/docs/functions/runtimes/python).

## Wide import quality

The production pack exposed repeated gate grouping in the existing `dataQuality.ts` routing detector. Gate partitions are now built once per source table. Candidates retain the same order, 15-key limit, 95 percent split criterion, missing tokens and preference for the most complete gate. An equally complete later gate never replaces the first. A complete fitting gate is final because no later gate can improve its missing count. Measured fixture parity and independent boundary checks accompany this shared-library change; it changes no stored rows or statistical estimates.

## Worker transport

Wide CSV conversions produce large JSON replies even when the source file is small. The local worker listener now scans each incoming chunk once and joins fragments only at a complete newline, preserving UTF-8, reply IDs, empty-line handling, restart and error responses. Protocol tag 7 replaces a version-6 listener retained by a dev-server hot reload. Payloads and statistical values are unchanged. The framing benchmark excludes Python calculation, database and browser time; it is not a total import-time claim.

## Visible-screen recognition

The U&A tile waits until its Analytics tile intersects the viewport before requesting recognition. Existing section panels can remain mounted while hidden. The mounted regression measures one full-file recognition request before this guard and zero while hidden afterward; entering the viewport starts exactly one request, and repeated observer entries add none. Failure is visible and a reopened tile can recover. This is a request-count improvement, not a claimed end-to-end upload timing improvement.
