# Questionnaire to variable linking

A questionnaire's items are linked to a raw data file's variables so tables and charts can show the
question wording, answer labels and the questionnaire's don't-know codes (`labelOverlay.ts`,
`claude/questionnaire-meaning-failure.md`). Matching suggests; the researcher confirms.

**Where.** The pure matcher is `src/lib/instrumentMatch.ts` (`matchItems`, `exactCodeVariables`,
`codeFamily`, `matchableCode`). Persistence and confirmation are in `src/lib/instruments.ts`
(`suggestInstrumentLinks`, `setInstrumentLinkStatus`, `confirmInstrumentLinks`,
`chooseInstrumentLink`, `chooseInstrumentLinkFamily`), with actions in `instrumentActions.ts` and the
review table in `src/app/runs/[id]/InstrumentCard.tsx`. Links are `instrument_links` rows (method
code, stem, wording or manual; status suggested, confirmed or rejected; unique per item, data file
and variable).

**Identity is the raw code.** `matchableCode` is the item code with NFKC applied, spaces and
invisible characters removed and trailing punctuation dropped ("EN20." and "EN20​" are EN20).
`exactCodeVariables` compares names without case, with `_`, `.` and `-` as one separator (EN20.1 is
EN20_1); where none is equal it ignores separators (Q1a is Q1_a), but never across a separator
between two digits, so EN201 is not EN20_1 (before 22 October 2026 it was, and an item EN201 took
EN20_1 at full confidence). Labels and wording are used only when no code route applies.

**Routes and confidence.** For each item, in order:
1. Exact code: confidence 1.
2. Multiple-response family (`codeFamily`, Grant 22 October 2026, FinScope EN20): two or more
   variables named the code, a separator (`_`, `.` or `-`) and a suffix, when no variable has the
   code itself. Every member is suggested from the stem at `FAMILY_CONFIDENCE` 0.92, method stem.
   The separator is the boundary: EN2 never takes EN20_1, EN20 never takes EN201.
3. Other stems: a letter suffix (EN20a, EN20r1) or a single suffixed variable, 0.85 (0.8 alone), as
   these may be separate questions.
4. A variable label that starts with the code: 0.9.
5. Grid rows (batch 53, `gridRowMatches`, method `grid`, migration 0130; Grant 28 October 2026, May 2026 IGS
   Poll): a grid asks one question (the stem) about several rows, with one single-choice column per row. A
   column's label is read as stem and row: the leading column name set aside, the row after the last dash with
   spaces around it (`gridRowOf`). For a questionnaire the wording of each column's confirmed codebook entry is
   read as well, since a data file often has no labels and only the codebook says "Q5_1 Regardless of whom ...
   - Tony Thurmond". When the item's question (its text up to the first question mark, `normalisedWording`) is
   the stem of two or more columns, exactly or followed by a note ("(already voted)"), each column is suggested
   at 0.92 when that grid fits that item only and the item that grid only; otherwise at 0.8. Codes may differ
   ("5A" and Q5_1); rows match by their labels, never by position (fieldwork may randomise them). Derived
   columns ("(summary)", "Combines ...", a name ending `_summary`) are never rows. Questions under five words
   are too short to call a stem the same. Before migration 0130 the method is not allowed and no grid link is
   made, so matching is as it was.
6. Wording overlap: at most 0.89, one variable per item.
Each variable goes to the highest-confidence item, so a family member cannot be taken by another
question's wording or label route, while an item with that exact code still wins.

**Confirm all for one question** (batch 53): a question with two or more suggestions (a grid's rows or a
family) shows "Confirm all N for <code>", which confirms every suggestion of that question through the same
rule as Confirm (`confirmInstrumentLinks` with the item; a column another question already has stays a
suggestion and is named). A question's links are listed in the data file's column order.

**Confirming.** "Confirm same-code matches" confirms suggestions at or above `AUTO_CONFIRM_MIN` 0.9 (grid rows at
0.92 included):
exact codes, families and label-code matches; wording and other stems stay for the researcher (the
button's tooltip says so). Every confirmation path uses `variableTakenBy` under the data file's lock:
a variable confirmed for one question is refused for another, with that question named.

**Matching again** deletes only suggested links and inserts with `on conflict do nothing`, so
confirmed, rejected and hand-chosen links are never changed, and a confirmed variable is not
suggested for another question.

**By hand.** "Choose variable" links one variable, confirmed as manual. When the question's code
names a family in the file, the picker also offers "Link all N in EN20_*"
(`chooseInstrumentLinkFamily`): every member is linked as manual, confirmed, in one transaction under
the lock; a member confirmed for another question is skipped and named; a member the researcher
rejected for this question stays rejected; the variable sent must belong to the family. Repeating
it links nothing new. The review table names a family once ("Multiple-response family: EN20_1 to
EN20_12 (12 variables)") and lists the first six links, with "Show all N links".

**Labels for a family.** `buildLabelOverlay` treats an item linked to several variables as a
multiple-response set: it sets only the question tooltip for each member, never a variable label
or answer labels, so a stem's (often empty) options never replace the members' own value labels and
no don't-know code is taken from the stem. Stated routing on the stem (for example "IF EN20 = 998
SKIP TO EN31") is read per linked variable by `buildStatedRouting` as for grid questions; it is
shown in the quality checks and does not change figures.

**Tests.** `instrumentMatch.test.ts`, `instrumentFamilyMatch.test.ts` (pure),
`instrumentFamilyLink.db.test.ts`, `instrumentManualLink.db.test.ts`, `gridRows.test.ts`, `gridLinks.db.test.ts`,
`gridLinksPre0130.db.test.ts`, browser `grid-question-links`,
`instrumentConfirmCollision.db.test.ts` (real PostgreSQL), browser `questionnaire-manual-link` and
`questionnaire-family-link`.

**Limits.** At most 60 variables per stem (`STEM_CAP`). A family whose members are named
differently from the question code (for example EN20 asked, data named NET_1 to NET_12) is not
found by code; it needs the picker. Matching is per data file. When another question's skip names a
family stem as its gate ("IF EN20 = 998"), `buildStatedRouting` takes the first linked member as the
gate variable with the stem's options; for a dichotomy family that gate cannot be evaluated
meaningfully. This affects the routing check shown on Data quality only, as it already did for grid
stems, and is not changed here.
