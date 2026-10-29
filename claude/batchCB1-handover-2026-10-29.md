# Batch CB1 handover: codebooks linked across waves, confirmed where the codes fit, and question search (29 October 2026)

Status: implemented, ready for independent review. Branch cb1 (worktree b90), on BatchD3aR. Tier A (engine
dictionary, link persistence and a migration), with a tier B screen part (the search).

## What Grant asked

- "Doesn't look like the codebook is being linked. Also, a link of codebook is manual for each wave, I think it
  should be automatic."
- "Looks like the codebook is not being read correctly? No variables are picked up in the analytics."
- "The variable list is long, needs a smart search option."

## Changed behaviour

1. **A codebook is matched to every wave without a click** (`matchCodebookToDataFiles`).
   - A file counts when at least half of the codebook's named entries, and at least three, are exactly variable
     names in it (`sharesCodebookNames`).
   - Another study that shares a few names is left alone and reported.
   - Each file's outcome is shown on the codebook's card: confirmed, suggested, too few names, or failed with the
     reason. One failure does not stop the others.
2. **Waves added later.**
   - The summary counts data files with no link from the codebook (`unlinkedDataFiles`).
   - The page matches them once per page (`matchCodebookToNewDataFilesAction`).
3. **Confirmed where the codes fit.** An entry is confirmed automatically when both hold:
   - its code is exactly one variable's name;
   - its answer list covers every code that variable holds in the data (`answerCodesFit`).

   For this, the engine now records each variable's observed codes (`codes`, up to 60 whole-number values;
   dictionary version 16; workbook and text files rebuild older caches).

   Anything unknown stays a suggestion:
   - no answer list;
   - a measure, text or decimals;
   - too many values;
   - an old dictionary.
4. **Re-checked, and the researcher's word kept.**
   - Every match re-checks the automatic links: one that no longer fits returns to a suggestion.
   - Any status the researcher sets is recorded as theirs (`decided_by = 'researcher'`). Matching never changes
     it, including a link the researcher returned to a suggestion.
5. **Brand names from labels without a separator.** Labels such as "Prompted resolved recognition Toyota" now
   give the brand ("Toyota"): the words all members share at the start and end are the question.
   - Two items left with the same words, or numbered codes alone, give no list.
   - This is what Grant's BMW Master_Codebook needs.
6. **Question search in Customise dashboard.**
   - Each customer satisfaction question is chosen in a search box (`QuestionPicker`), matching name, label and
     research words: awareness finds recognition and recall, nps finds recommend, churn finds switch.
   - Driver questions have a search.
   - "Choose a question" on a blank tile opens Customise with the search box focused.

## Impact checklist

- **Rule.** New registry rows:
  - automatic confirmation: `answerCodesFit`, written by `suggestInstrumentLinks`;
  - question search: `searchVariables`.

  The matching-target row now includes `matchCodebookToDataFiles`. The contract is `claude/codebook-import.md`,
  section CB1. The exact-name rule is the existing `exactCodeVariables` (no second version).
- **Inputs.** Unknown codes, no answer list, or a dictionary without codes are never a fit, so the entry stays a
  suggestion. A file whose dictionary cannot be read is reported as failed; it is never left out silently. Before
  migration 0133 nothing is confirmed automatically, and the note says so.
- **Persistence.**
  - Each file's matching is one transaction under the existing locks (`lockLinkDocuments`: both files active in
    this project).
  - Inserts use `on conflict`, so a repeat adds nothing (shown in the test: 8 links after two runs).
  - A failed file leaves the others' committed results, and its outcome says it failed.
- **Freshness.** Confirming a codebook entry changes the labels and the meanings applied to that variable, as a
  researcher's confirmation does today. Tables read the links at calculation time, as before.
  - An automatic link that stops fitting returns to a suggestion, so it stops counting.
  - No wording or review decision is touched.
- **Screens.**
  - The wave matching runs once per page for each new set of files. A late result only sets the card's note.
  - The search changes only the draft; "Saved" is still shown after Apply succeeds.

## Migration

`supabase/migrations/0133_instrument_link_decided_by.sql`: adds `instrument_links.decided_by` ('automatic',
'researcher' or null), with a check constraint. It is additive and idempotent, and existing links are not
back-filled. Run `npm run backup -- --local` before applying. Migrations 0131 and 0132 are also still to apply.

## Tests

| What | Result |
|---|---|
| `codebookAutoLinks.db.test.ts` (real engine and disposable database) | 6 passed |
| `trackerRolesRaw.test.ts` | 18 passed, including 3 new |
| `variableSearch.test.ts` | 7 passed |
| `instrumentScope.db.test.ts`, updated | 5 passed |
| Affected suites after rebasing on D3aR | 95 passed, 2 skipped |

What `codebookAutoLinks.db.test.ts` covers:
- two waves matched;
- brand and nps confirmed;
- region suggested in the wave holding a code the codebook does not list;
- age (no list) suggested;
- the other study not matched;
- a repeat adds nothing;
- the researcher's reject, return-to-suggestion and confirm survive matching again;
- a later wave matched on its own, and the unlinked count goes back to 0;
- a codebook edit that stops fitting returns the link to a suggestion;
- an unreadable file reported as failed while the other wave is matched;
- before 0133, nothing automatic and the result says so.

Shown failing without the change:
- **Researcher guard removed:** 1 failed.
- **Codes check removed:** 2 failed.
- **Previous label rule (`trackerRolesRaw.test.ts`):** 2 failed.

`instrumentScope.db.test.ts` assumed every link starts as a suggestion. q1 is now confirmed by the codes rule.
The refusals it guards (a removed or foreign codebook, a confirmation racing removal) are unchanged, and the
test still checks that nothing changes during the race.

Browser:
- `codebook-waves.check.mjs` is rewritten to the new contract: two waves matched with "1 confirmed,
  2 suggested" each, then a third wave uploaded later and matched by itself.
- `tracker-dashboard.check.mjs` now chooses through the search: focus lands in the search box, typing narrows
  the list, Enter chooses, and the driver search reports no match.

- Four older checks followed the earlier rule that every same-code link waits for a click. CB1's own full
  browser run (139 passed, 1 skipped, 5 failed) showed it. They now expect the automatic confirmation:
  - `codebook.check.mjs`: party_reg arrives confirmed, so Confirm same-code matches confirms the other 2.
  - `codebook-questionnaire-links.check.mjs`: Q1 arrives confirmed. Q2's data now holds a code its list does
    not name, so it stays a suggestion and its buttons are checked.
  - `grid-question-links.check.mjs`: all four entries arrive confirmed, and nothing is left to confirm by code.
  - `codebook-waves.check.mjs`: the later-wave step opens Import data after each reload.
- The fifth failure, `waves-in-project.check.mjs`, timed out on a Setup control CB1 does not touch. It passed in
  D3aR's run and is checked again in the next full run.

Full gates: see the package note.

## Why the earlier tests missed it

The codebook tests matched one data file at a time and used codebooks with separators in their labels. No test
had several waves sharing one codebook with an expectation that it link to all of them, and none had Grant's
separator-free labels.

## Not yet

- A questionnaire item is linked through the codebook by identical wording only, not yet by the codebook's
  question number.
- A data file the codebook does not describe stays counted as "unlinked", so the page checks it once per visit
  (a dictionary read, no engine run when cached).
