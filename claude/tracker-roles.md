# Tracker roles: recognising a brand or CSM tracker (plan D1)

Owner: `src/lib/trackerRoles.ts` (`recogniseTracker`, `findBrandFrame`). Pure: no database, no model.
Grant, 28 October 2026: dashboards "automatically generated from imported data"; roles must come from
"question types, brand codes, response options and bases, not just variable names". Expected roles for the
test packs: `claude/tracker-packs-role-spec-2026-10-28.md`.

## Input

One `RoleVariable` per variable: name (identity only), label or question wording (meaning, never a
category's identity), value labels (code to label; codes are the identity), and when a codebook gives them
the question ID, question type and multiple-response group. Weights and free text are not read.

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
   stated category moments, channels) is its own list: never brands, never attributes.
6. **CSM roles.** Overall satisfaction (a satisfaction rating of the company, provider or bank, not of a
   channel, with a satisfied end on its answer list); likelihood to recommend with a 0 to 10 list; likely to
   stay (continue, stay, remain); likely to switch (not price switching); drivers: the largest battery of
   three or more ratings in one question sharing one poor-to-excellent list (importance batteries excluded).
   Two candidates for a role are asked about.
7. **Type.** Brand when there is a brand list and at least two funnel or usage stages; CSM when there is overall
   satisfaction and a 0 to 10 recommend question; both, or unknown.

Always asked: which brand is the client's (the data never says).

## Tests and limits

`trackerRoles.test.ts` on the BMW, banking, insurance and telecoms brand packs and the banking CSM relationship
file (fixtures built from their codebooks), plus will-not-guess cases. CSM roles read ratings only (a scale, or
three or more answers): a yes/no attribute that mentions switching is not a likelihood to switch. Not yet
covered: the mobile CSM pack; files with no codebook (labels only); the channel-grain CSM file. Roles are suggestions: the
configuration that uses them (D2) saves the researcher's confirmations and keeps them across waves.
