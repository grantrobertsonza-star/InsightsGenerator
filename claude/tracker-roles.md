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
   rejection (brand opinion), trial (ever), frequent use (most often, BUMO), repeat, then (R5) a purchase or use
   question in a recent window, then acquisition, then usage. A funnel stage claimed by two questions is asked about;
   advertising, word of mouth and moment measures may be several.
   - **Recent purchase or use is usage (R5, Grant 30 October 2026).** A wording with a buying word (bought, buy,
     purchase) or a using word (use, used, consume, drink, ate, shopped) and a recent window (past week, past month or
     4 weeks, past 3 months, past 6 months; P1W, P1M, P4W, P3M, P6M; the window from the wording, else from the answer
     labels, rule 3a) is usage in that window: FMCG penetration. Not when the wording is about taking a brand up
     (acquired, acquisition, started, joined, switched, signed up, took out, opened): "Acquired", "Recently acquired"
     and "Started using in the past 3 months" stay acquisition. This rule runs after repeat and before acquisition,
     so "Bought in the past 3 months" is no longer acquisition by "bought".
   - **A purchase in the past 12 months depends on the tracker type (decided R5).** A buying word (not a take-up
     word) with a 12-month window is acquisition for Durables (as before) and annual penetration (usage) for FMCG. The
     recogniser gives `stage` = acquisition and `stageByType` = {durables: acquisition, fmcg: usage};
     `resolveDashboard` applies the type in effect to a stage the researcher has not chosen, and only when no other
     question already has that stage (an FMCG file with P3M and P12M keeps P3M as usage and P12M as acquisition, so
     the type never creates a contest). A take-up wording with a 12-month window ("Past 12 month household
     acquisition", "Past 12 months category start") is acquisition for both types and has no `stageByType`.
   - The BMW, banking, insurance and telecoms packs keep every stage they had (owner and current are usage; bought12,
     started12 and started90 are acquisition; telecoms' "Past 90 days category start" is a take-up, so acquisition).
3a. **Time window** (`window`, `windowReason`; owner `src/lib/trackerWindows.ts` `windowOf`, R5). One of past week,
   past month (also 4 weeks, 30 days, P1M, P4W), past 3 months (also 12 or 13 weeks, 90 days, a quarter, P3M), past 6
   months, past 12 months (also a year, 52 weeks, "12 month", P12M), ever, currently (current, own, owner, ownership,
   now, these days), or unknown. Read from the wording with the brand taken out; when it states none, from the answer
   labels when they agree on exactly one ("Bought in the last 4 weeks" as the yes answer); two different periods in
   one wording, or in the labels, are unknown with the reason. Unknown is never read as any period. Shown beside the
   stage on every tile, funnel row and chart ("Usage, past 3 months"; `windowSuffix`): a known window always, an
   unknown one only for a behaviour stage (trial, usage, frequent use, acquisition, repeat) as "window not stated".
   Wave comparison (`changesAgainst`, `windowChangeReason`): a stage is compared only with the same window in both
   waves; a changed window is withheld with "The time window changed (past 3 months in the previous wave, past month
   now), so it is not compared."; the trend chart draws no point for a wave with another window and says why. Two
   unknown windows are treated as the same (the same variable at the same stage states no period in either wave); a
   known window against an unknown one is withheld.
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
7. **Type.** Brand when there is a brand list and at least two funnel or usage stages; CSM when there is overall
   satisfaction and a 0 to 10 recommend question; both, or unknown.
7a. **Tracker type** (`trackerType`, R5; owner `src/lib/trackerType.ts` `suggestTrackerType`): Durables or FMCG
   (an enum; "services" may follow and is not offered). Suggested from the recognised stages and windows, with the
   reason: FMCG when the file has a usage question in a window of 3 months or less (past week, month, 3 months) or a
   bought most often question (frequent use, BUMO), and no shortlist or first choice question; otherwise Durables
   when it has a shortlist or first choice question, current ownership or use (usage, currently), or an acquisition
   in the past 12 months; otherwise no suggestion ("Choose one"). No brand list, no suggestion. The researcher's
   saved choice replaces it (one dropdown, "Tracker type", in Customise; `TrackerChoices.trackerType`, saved through
   `saveTrackerChoices` with the revision check). It sets the brand overview's stages and order
   (`overviewStagesFor`, exposed as `ResolvedDashboard.overviewStages`): Durables = awareness, consideration,
   shortlist, first choice, usage (owner), acquisition; FMCG = awareness, consideration, trial (ever tried), usage
   (bought in the window), frequent use (bought most often); no type = the list used before tracker types
   (awareness, consideration, shortlist, first choice, trial, usage, frequent use). The headline trend charts are
   the first four of that list. The type never changes which question a stage reads, except the 12-month purchase
   reading in rule 3; the researcher can still map any question to any stage. A stored value that is not a type is
   reported under "Still to decide" and the suggestion is used until a type is chosen; a new value that is not a
   type is refused on save.

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
    often", "regular", "BUMO") before repeat; "P3M", "P1M", "P6M", "P1W", "P4W" and "past 3 months" are usage; "WOM"
    is word of mouth; "same brand" is repeat.
12. **CSM from raw files.** Wording is the label, else the name's words ("OverallCompanySatisfaction_0to10" is
    "Overall Company Satisfaction 0 to 10"). A number with three to eleven values is a rating; its scale top is
    the answer list's, else the range its wording states ("0 to 10"), else the size its name ends in
    ("company_csat5", "continue5"). "CSAT" is satisfaction. Among several overall satisfaction ratings, the one
    about the company (provider, bank, brand) is chosen when it is the only one; among several recommend
    questions, the likelihood one. Drivers without answer labels: the largest family of ratings on one scale,
    importance families excluded; families of equal size are asked about.

Always asked: which brand is the client's (the data never says).

## Tests and limits

`trackerFmcg.test.ts` (R5): an FMCG codebook in codebook, CSV-codebook and labels-only forms; wording variants (P3M,
past three months, last 4 weeks, past month, P1M, past week, last 13 weeks, past 6 months); take-up wordings kept as
acquisition; a durable's "bought in the past 12 months"; the window from answer labels; the BMW pack unchanged; the
type suggestion, choice, unknown stored value and stage order; the window rule in wave comparison.
`trackerFmcg.db.test.ts`: the same on a two-wave synthetic snack tracker (fixtures/tracker-fmcg) through the real
engine and database, figures equal to an independent pandas reading.
`trackerRoles.test.ts` on the BMW, banking, insurance and telecoms brand packs and the banking CSM relationship
file (fixtures built from their codebooks), plus will-not-guess cases. CSM roles read ratings only (a scale, or
three or more answers): a yes/no attribute that mentions switching is not a likelihood to switch. `trackerRolesRaw.test.ts` (fixtures/tracker-raw) on Grant's raw files as the engine reads them:
brand_tracker_Oct_2025.xlsx, Synthetic_Brand_Tracker_03_Rotated_Competitors.xlsx, csm_Wave1_Baseline.xlsx, the
banking CSM relationship CSV without its codebook, and the BMW wave as SPSS with labels only and as a plain CSV.
Not yet covered: the mobile CSM pack; the channel-grain CSM file; names separated by something other than "_"
(dots, camel case only); a brand list spread over several name parts. Roles are suggestions: the
configuration that uses them (D2) saves the researcher's confirmations and keeps them across waves.
