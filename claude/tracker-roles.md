# Tracker roles: recognising a brand or CSM tracker (plan D1)

Owner: `src/lib/trackerRoles.ts` (`recogniseTracker`, `findBrandFrame`). Pure: no database, no model.
Grant, 28 October 2026: dashboards "automatically generated from imported data"; roles must come from
"question types, brand codes, response options and bases, not just variable names". Expected roles for the
test packs: `claude/tracker-packs-role-spec-2026-10-28.md`.

## Input

One `RoleVariable` per variable: name (identity only), label or question wording (meaning, never a
category's identity), value labels (code to label; codes are the identity), and when a codebook gives them
the question ID, question type and multiple-response group, and the count of distinct values. Weights, free
text and survey-design columns (module selection, selection probability, response status, inverse selection
weight) are not read.

D2 builds it from what the app has read (`src/lib/trackerInput.ts` `loadRoleInput`; pure assembly in
`src/lib/trackerRoleVariables.ts`): the crosstab engine's dictionary; every variable's answer labels as the
calculations see them (engine action `value_labels`: the file's own labels, then the confirmed codebook and
questionnaire labels by the engine's overlay rule); the strongest confirmed codebook entry's question number,
type and set (`instrument_items.question_meta`, migration 0131). Without codebook fields, a set the reader found
(a yes/no set, or a battery asked per brand) gives the question group, by its name stem, so a question the
reader split in two (repeat_b01 to b06 as flags, b07 to b10 with no "yes" in the cases read) stays one question.
A short list of repeated text answers is a category, not free text (`isStringCategory`). A failed read of any of
these refuses; it never becomes an empty list.

Grant, 29 October 2026: "it will 90% be standard raw files" (SPSS, Excel, text, R, Python). Most files carry no
codebook question fields, and many carry no answer labels at all.

## Rules

1. **Brand list (frame).** An answer list of a single-choice question whose names reappear in other questions'
   wording ("Consideration Toyota"). At least three names, and at least 60% of the list, must be named
   elsewhere; the list named most wins. A rating scale shared by many questions ("Would never choose" ...
   "First choice") is never the brand list, because its answers are not named in other wording (the trap in
   Grant's preview). Answers that are never brands (Other, None, No first choice yet, Don't know, Not
   applicable, Prefer not to say) are set aside by their words, whatever their code, and listed for the
   researcher to confirm.
2. **Per-brand questions.** A group (multiple-response set, else question ID) whose variables name most of the
   brands (at least three and 60%), one variable per brand, by label. A brand's names include its label without
   a parenthetical note and a former name ("GoTyme Bank (formerly TymeBank)"); a name inside a longer one goes
   to the longer (FNB and FNB Connect). Variables of the group that name no brand (an exclusive None, an Other
   flag, a routed duplicate) stay outside.
3. **Stage** from the question's wording once the brand is taken out, in order: advertising, word of mouth,
   moment (CEP links, mental availability), unaided awareness, awareness, consideration, shortlist, first choice,
   rejection (brand opinion), repeat, acquisition, usage. A funnel stage claimed by two questions is asked about;
   advertising, word of mouth and moment measures may be several.
4. **Brand grids.** A per-brand group whose wording is "<brand> associated with <attribute>" or "<brand> recalled
   for <situation>" is one item of an associations or moments grid.
5. **Other lists.** A group of three or more yes/no options none of which is a brand (media, purchase journey,
   stated category moments, channels) is its own list: never brands, never attributes. The **category moments**
   question among them (`categoryMoments`, `findCategoryMoments`, D3c) is the one whose options are the same moments,
   in the same words, as the moments grid's items; see `claude/d2-design-2026-10-29.md`, D3c Moments & needs.
5a. **Prompted advertising recall** (`advertisingRecall`, `findAdvertisingRecall`, D3e): per-brand variables put
   together by their wording with the brand taken out (not by group: a codebook files the question as asked and its
   derived yes indicator under one question ID); stage advertising, not unprompted, unaided or spontaneous; an
   answer list; at least three brands and 60% of the list. The wording whose answers keep "not sure" apart is the
   question as asked; otherwise a single wording; otherwise ambiguous. See `claude/d2-design-2026-10-29.md`, D3e.
5b. **Age groups and media use** (`ageGroups`, `findAgeGroups`; `mediaUse`, `findMediaList`; D3f): asked once (no
   per-brand question, grid cell or brand list question). Age groups: a single-choice question whose own wording
   names age and whose answers are age ranges (two or more, 60% of the list). Media use: a group of three or more
   yes/no options whose own labels name media (three or more, 60% of the options other than None or Other). Never
   by a variable name alone; two candidates are ambiguous. See `claude/d2-design-2026-10-29.md`, D3f.
5c. **Decision style and acquisition channel** (`decisionStyle`, `findDecisionStyle`; `acquisitionChannel`,
   `findAcquisitionChannel`; D3g): single-choice questions asked once. Decision style: own wording about a decision
   style, making, process or approach, or how the respondent decides or chooses. Acquisition channel: own wording
   naming a channel and an acquisition (acquired, bought, purchased, started, joined), or where the respondent bought
   or acquired. Never by a variable name alone; two candidates are ambiguous. See `claude/d2-design-2026-10-29.md`, D3g.
6. **CSM roles.** Overall satisfaction (a satisfaction rating of the company, provider or bank, not of a
   channel, with a satisfied end on its answer list); likelihood to recommend on a stated 0 to 10 scale (Codex D1-F01: by `isZeroToTenScale` in
   `src/lib/descriptiveFindings.ts`, the rule the Net Promoter calculation uses: eleven or more answer codes below
   the non-answer codes, including 0 and 10; a 1 to 10 or 6 to 10 list is not one; a list labelling only some
   points, 0 and 10 among them, is asked about; in a raw file the wording must state "0 to 10"; no endpoint is
   inferred); likely to
   stay (continue, stay, remain); likely to switch (not price switching); drivers: the largest battery of
   three or more ratings in one question sharing one poor-to-excellent list (importance batteries excluded).
   Two candidates for a role are asked about.
6a. **Brand dashboard extension** (r6brandext): needs fit, differentiation, price justification, the same-episode
   ideal and actual brand and its reasons are recognised by their own owner, `brandExtensionRoles.ts`, called once
   from `recogniseTracker`; the variables it claims leave the measures, association items and "outside" lists above.
   "Cannot recall" and "No particular ..." answers are never brands (rule 1). See `claude/brand-extension.md`.
7. **Type.** Brand when there is a brand list and at least two funnel or usage stages; CSM when there is overall
   satisfaction and a 0 to 10 recommend question; both, or unknown.

## Raw files with no answer lists (D2, `src/lib/trackerNameFamilies.ts`)

Used only when rule 1 finds no labelled brand list.

8. **Families.** Variables whose names are the same except at one "_"-separated part (Aware_PlatoCoffee,
   Aware_MuggBean, ...: the family "Aware_*"). The varying part is the item's code, its identity, kept as
   written. Its label is the part of the variables' labels that varies ("awareness: Kora Coffee" gives "Kora
   Coffee" for awareness_b1), else the code's words ("PlatoCoffee" is "Plato Coffee", "McCafe" stays one word).
9. **Brand list from names.** The item list shared by the most families: at least three families, each with at
   least three of the list's items and at least 80% of its own items in the list. A code with no meaning of its
   own (b1, 3, m10) counts only when the labels give it one name, the same everywhere, so Q1_1 ... Q3_5 is never
   a list of brands "1" to "5". A list whose items are question wording (aware, consider: a file whose brands are
   numbered without names, read the other way round) is never the brand list; the researcher is then asked for
   the codebook or labels file (question "brand-names"). Items that are not brands (none of these brands, Other,
   Don't know) are set aside.
10. **Per-brand questions and grids from names.** A family named after one brand whose items vary
    (Association_PlatoCoffee_GoodService ..., moment_m1_b1, moment_m2_b1 ...) is that brand's row of a grid,
    however many brands were asked (moments when the name says moment, occasion, situation, CEP or need; else
    associations); "none" items are answers of the grid, not items. Every other brand family is a question asked
    per brand: its wording (label, else the name's words) without the brand gives the stage. A family of two
    values is yes/no. A family with no brand among its items or in its name is a list of its own.
11. **Stages added for raw files:** trial ("ever used", "tried") before usage; frequent use ("frequent", "most
    often", "regular") before repeat; "P3M" and "past 3 months" are usage; "WOM" is word of mouth; "same brand"
    is repeat.
12. **CSM from raw files.** Wording is the label, else the name's words ("OverallCompanySatisfaction_0to10" is
    "Overall Company Satisfaction 0 to 10"). A number with three to eleven values is a rating; its scale top is
    the answer list's, else the range its wording states ("0 to 10"), else the size its name ends in
    ("company_csat5", "continue5"). "CSAT" is satisfaction. Among several overall satisfaction ratings, the one
    about the company (provider, bank, brand) is chosen when it is the only one; among several recommend
    questions, the likelihood one. Drivers without answer labels: the largest family of ratings on one scale,
    importance families excluded; families of equal size are asked about.

Always asked: which brand is the client's (the data never says).

## Tests and limits

`trackerRoles.test.ts` on the BMW, banking, insurance and telecoms brand packs and the banking CSM relationship
file (fixtures built from their codebooks), plus will-not-guess cases. CSM roles read ratings only (a scale, or
three or more answers): a yes/no attribute that mentions switching is not a likelihood to switch. `trackerRolesRaw.test.ts` (fixtures/tracker-raw) on Grant's raw files as the engine reads them:
brand_tracker_Oct_2025.xlsx, Synthetic_Brand_Tracker_03_Rotated_Competitors.xlsx, csm_Wave1_Baseline.xlsx, the
banking CSM relationship CSV without its codebook, and the BMW wave as SPSS with labels only and as a plain CSV.
Not yet covered: the mobile CSM pack; the channel-grain CSM file; names separated by something other than "_"
(dots, camel case only); a brand list spread over several name parts. Roles are suggestions: the
configuration that uses them (D2) saves the researcher's confirmations and keeps them across waves.
