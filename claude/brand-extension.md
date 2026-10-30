# Brand dashboard extension (r6brandext, 30 October 2026)

Source: Grant's packs of 30 October 2026, `fixtures/packs-2026-10-30/brand/` (banks, insurers, telecoms, cars), and
their `03_Claude_Dashboard_Extension_Guide.docx` (the same guide in every pack). Status: implemented, ready for
independent review.

Owners:

| Part | Owner |
|---|---|
| Recognition (which questions are E1 to E6) | `src/lib/brandExtensionRoles.ts` `recogniseBrandExtension`, called once from `trackerRoles.recogniseTracker` |
| Confirmations applied | `brandExtensionRoles.withConfirmations` |
| Other brand names | `brandExtensionRoles.normaliseBrandName`, `resolveOther` |
| Figures | `src/lib/brandExtension.ts` `loadBrandExtension` (`brandRatingFrom`, `episodeFigures` pure), `loadBrandExtensionTrend` |
| Confirmations stored | `src/lib/brandExtensionConfirmations.ts` (migration 0140) |
| Server boundary | `src/lib/brandExtensionActions.ts` |
| Screens | `src/app/runs/[id]/BrandExtensionViews.tsx`, `VariablesSelector.tsx`; two lines in `TrackerDashboardPanel.tsx` |

## Recognition

Never from a variable name alone. A name that looks like a construct (`needsfit_bXX`) without wording or answer labels
gives "Needs review" with no candidate, never a mapping.

1. **Ratings (E1 needs fit, E2 differentiation, E3 price justification).** Variables with an answer list, grouped by
   their wording once the brand is taken out (`trackerRoles.brandNamed`, `stemOf`; the brand list from
   `findBrandFrame`): one variable per brand, at least three brands and 60% of the list. The answer list must be five
   consecutive codes running from "Strongly disagree" to "Strongly agree" (`agreementScale`); a yes/no pick-any
   association is never a rating. Cannot-judge answers ("Do not know enough to judge", "Not familiar enough with its
   prices to judge") are read from the question's own labels; any other code makes the construct "Needs review".
   The construct comes from the wording: needs fit needs the respondent's own needs ("meets my personal needs"), so
   "alternatives that meet similar needs" in E3 is not needs fit; differentiation "meaningfully different",
   "stands out", "unique"; price justification "worth its fees / premiums / costs / price". Category relevance
   (`relevant_cXX`, yes/no, asked once) never qualifies. Two families for one construct, or one family reading as two
   constructs: "Needs review".
2. **Episode pair (E4 actual, E5 ideal).** Single-choice questions whose answers are the tracked brands by label
   (60% of the list). Actual: wording says actually chosen (bought, opened, activated ...) for the most recent or last
   event, not ideal. Ideal: "ideal(ly)" with "same" or "at the time" and the most recent event. Future first choice,
   the main or current brand, most used and ownership are excluded by wording. The event text (from "most recent" to
   the end of the clause) must be the same in both, and the brands must carry the same codes in both; otherwise
   "Needs review" naming the two events. Codes by meaning from these two questions' labels: Other (96), no particular
   ideal (98), cannot recall (99). Other name texts: text variables labelled other + name + actual/ideal. Route flag:
   a 0/1 variable about the episode being available. The file's derived gap flag: a 0/1 variable about the ideal
   and actual brands differing whose answers are "Same ..." and "Different ...".
3. **Reasons (E6).** A set (codebook MR set, else the reader's set, else question number) of three or more yes/no
   options whose labels share one question part before a colon naming reasons and the gap ("Choice gap reason:").
   The exclusive flags outside the set: "No reason ..." and "Cannot recall why ... differed", each with its own
   selected code read from its labels (its 1 is labelled with the option, not "Selected"). The Other reason text and
   "Another reason" option. The route (asked only when the brands differ) is checked against the data.
4. The variables a found or candidate construct uses are removed from the funnel recogniser's measures, association
   items and "outside" lists, so no "What does ... measure" question and no stray association item appear.
5. `NON_BRAND` in `trackerRoles.ts` now also sets aside "Cannot recall" and "No particular ..." answers: without it the
   episode question became the brand list with "Cannot recall" as an eleventh brand (it is named in another
   question's wording). Earlier fixtures are unchanged (`trackerRoles.test.ts`, `brandExtensionRoles.test.ts`).

## Figure contracts

All figures through `computeCrosstab` (nothing saved), `excludeDk: false` so every code reaches the reader and each
question's own answer list decides what counts; respondents selected by engine filters on raw codes ("between" a code
and itself) or on an Other name's own text ("in"); weighted counts are the engine's unrounded `countExact`.
Weight: the dashboard's setting unless the page asks weighted or unweighted; a file without a weight is unweighted,
said. Survey design: the file's. Optional audience: one answer code of a single-choice question asked once.

| Figure | Numerator | Denominator | Population | Missing |
|---|---|---|---|---|
| Distribution, code c | weighted ratings c | weighted ratings 1 to 5 | aware of the brand (awareness question's selected code) | 9, blank, other codes outside |
| Top-two-box | weighted ratings 4 or 5 | weighted ratings 1 to 5 | as above | as above |
| Mean (labelled 1 to 5 agreement) | sum of code x weight over 1 to 5 | weighted ratings 1 to 5 | as above | as above |
| Cannot judge | weighted code 9 (the question's own) | weighted aware | aware | blank counted as missing |
| Missing | aware with no answer | shown as a count | aware | never added to any base |
| Route break | answered while not aware | shown as a count | not aware | never in any base |
| Ideal share of b, actual share of b | weighted pairs with that side = b | weighted paired-known base | eligible, both identities known | 98, 99, unresolved Other, unanswered: statuses beside the chart |
| Gap rate | weighted pairs whose identities differ | weighted paired-known base | as above | as above |
| Fulfilment of b | weighted pairs ideal b and actual b | weighted pairs ideal b | ideal b, actual known | as above |
| Reason r | weighted r selected | weighted completed E6 (a reason or an exclusive option selected) | the file's gap flag = different | unanswered E6 shown as missing, never "no reason" |
| Reason r for brand b | as above | as above | gap and ideal = b | as above |

Statuses, one per respondent in this order: no particular ideal; cannot recall (either side); answer code not on the
list; Other with no name (unresolved). "No episode" from the route flag; "Asked, no answer" for eligible respondents
with no actual answer, or an actual and no ideal. Identity: tracked brand by its code mapped to the brand list by
label; Other by its normalised name (trim, case-fold, collapse whitespace) or a confirmed alias; two Others match only
when these match. A typed tracked brand's name stays Other until an alias is confirmed (offered as "Needs review").
Completed E6 is the union of the substantive reasons' NET and the two exclusive flags, by inclusion and exclusion
over engine tables; respondents in two of the three sets are counted as exclusive conflicts. Other reason text is
counted with and without "Another reason" selected.

Bases shown: raw n, weighted base, Kish effective base where the engine gives it for exactly that base (valid ratings:
a table restricted to codes 1 to 5; paired base: the file's gap flag's valid answers when they are the same
respondents; completed E6: not available, said). Small bases: below 50 flagged, below 30 descriptive only (no
interval), by `trackerAudience.smallBaseLevel`. Interval for top-two-box: 95%, p +/- 1.96 sqrt(p(1-p)/n_eff), weights
only. No brand comparison is tested (same respondents within a wave: repeated measures); waves are independent and
the trend is descriptive, a wave joined only when its question has the same wording and codes.

States: a construct the file lacks: "Not measured" with what is missing. In review: "Needs review" with the
candidates. No awareness question mapped: "Mapping needed". A measured figure with no valid base: "Not available"
(null), never 0%.

## Confirmations (migration 0140)

`brand_extension_confirmations`, one row per programme (or project in no programme), compare-and-swap on `revision`
under the project's row lock, the file checked in the same transaction, `previous_confirmations` kept. Entries:
for a construct in review, the chosen candidate's key (its variable names) or "not_measured"; Other name aliases (a
normalised name to a tracked brand's code or to another Other name). Each with who, when, which file and the candidate
description. Checked on the server against this wave's recognition; a construct found without doubt cannot be
overruled. Before migration 0140: figures still shown, saving refused with the reason. A malformed stored record is an
error.

## Freshness

Nothing derived is saved: the pages are computed when opened. A confirmation or alias changes the figures on the next
load; no finding, insight, recommendation, narrative or export reads these pages yet.

## Tests

`brandExtensionRoles.test.ts`, `brandExtensionFigures.test.ts`, `brandExtensionViews.test.tsx`,
`brandExtensionReference.{banks,insurers,telecoms,cars}.db.test.ts`, `brandExtensionEdge.db.test.ts`,
`scripts/crosstab_selftest.py` ("r6brandext"), `e2e/ui/tracker-brand-extension.check.mjs`.
