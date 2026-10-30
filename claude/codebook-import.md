# Codebooks and spreadsheet questionnaires

Grant, 26 October 2026: "Berkeley, World Bank etc use codebooks extensively. A codebook could be a Word,
xls or pdf file." A codebook is a fourth instrument type (`documents.instrument_type = 'codebook'`,
migration 0118), read into the same `instrument_items` as a questionnaire, linked to a data file through
the same `instrument_links`, and applied through the same label overlay (`getLabelOverlay`). Nothing new
is stored and no second link or overlay path exists.

**Reading** (`readClaimedInstrument` in `src/lib/instruments.ts`):
- A codebook in CSV, TSV, delimited text, Excel or JSON is read by the engine without the model
  (`codebook_items` in `api/parse-stats-file.py`). Each variable is an item whose code is the variable
  name, whose text is its label (or the name), and whose options are its answer codes and labels.
  - Columns (batch 51, IS-F05): the names column is the one a header row names, unless that column holds
    almost no one-word cells (under 20%) while another column is mostly name-like (60% or more): the
    Berkeley IGS Poll codebook heads its name column "VARIABLE LABEL", the wrong way round. Without such
    a header, the column of name-like cells (60% or more). The label column is the header's, else the
    longest remaining text. The values column holds answer lists, read or not (20% or more).
  - The header row, and any title rows above it, are never variables (IS-F07, Codex 28 October 2026:
    "VARIABLE NAME,LABEL,VALUES" over "q_2028,Satisfaction,..." gave a variable "LABEL" and took the label
    "Satisfaction" for the name, so the answers were confirmed onto a data column called Satisfaction).
    A one-variable codebook under a multiword header ("VARIABLE NAME, VARIABLE LABEL") is read.
  - Names are kept exactly as written (`_cb_name`): any text up to 256 characters with no line break, so
    "Age years", "回答", "_Q1", "123" and "__proto__" are read as the data reader reads its columns. The
    name-like pattern only finds the column and splits "Q1, Q2"; it no longer drops names (they were
    dropped while the read said complete). One filled cell that is not name-like is a section heading.
  - Answer lists (`_cb_list`, IS-F02 and IS-F04): a code is kept exactly as written through `_cb_code`,
    the rule the long and JSON layouts use (B36-F01), so "01" and "1" are two codes and
    9007199254740993 is not rounded (it used to be converted through a number: Codex's 50% became 33.3%).
    A code is a quoted text or a run with no space, comma, "=" or quotation mark ("AA", "A_B", "C-D",
    "1e0", "-9", "1.5"). A label in quotation marks may hold commas; an unquoted label runs to the next
    ", <code>=". A cell with "=" that is not such a list ("=Yes", "1=Yes 2=No") is an unread list: the item
    keeps no answers, the read is reported incomplete (`unreadValues`, counted in `incompleteItems`), and
    the item does not replace an earlier complete reading of it. Text without "=" ("as is") is not a list.
  - One row per value (variable, value, value label, with the variable repeated or blank) is read by
    its header names (`_classify_header`).
  - A row with one filled cell is a section heading; a name cell listing several names gives each the
    row's label and values; values written another way ("as is", "1 thru 58") give no answer list.
  - The first description of a variable wins; a later one is not a second item.
  - JSON: a list of variable objects, an object of such lists under `variables`, `fields` (Frictionless
    Table Schema), `items`, `columns` or `codebook`, or an object keyed by variable name. Values as
    `{"1": "Yes"}`, `[{"value": 1, "label": "Yes"}]` or `[[1, "Yes"]]`.
  - A file with no codebook table is refused with what was expected; nothing is stored.
- A codebook in Word or PDF is read by the model with a codebook prompt (variable name as code).
- A questionnaire in Excel or CSV: an XLSForm (ODK, KoboToolbox, SurveyCTO: `survey` and `choices`
  sheets) is read without the model (`instrument_sheet`, `_xlsform_items`): question name as code, label,
  its choice list as options, groups as sections, `relevant` kept as routing text (not parsed as a skip
  instruction). Any other spreadsheet's sheets are turned into text, row by row, and read by the model
  as a Word or PDF questionnaire is.

**Linking.** `suggestInstrumentLinks` matches the item code to the variable name exactly
(confidence 1), so a codebook's variables are strong matches; "Confirm same-code matches" confirms them.
When several columns are the code once case, spacing and separators are set aside (q1 and Q1, Q_1 and
Q.1, Q1 and Ｑ１), the one written exactly as the code wins (as written, then after NFKC); when none is,
each is offered at 0.8, below "Confirm same-code matches", for the researcher to choose (IS-F06, batch
51: each used to be offered at 1 and the item bulk-confirmed to all of them).

**Scope (IS-F03, batch 51).** A link counts only while both its ends are active files of the link's
own project: the question's codebook or questionnaire and the data file, neither in the bin
(`LINK_ENDS_ACTIVE`, used by `getConfirmedItemsForData` and by a codebook link's basis). Every write
that creates or confirms a link (`suggestInstrumentLinks`, `setInstrumentLinkStatus` confirming,
`confirmInstrumentLinks`, `chooseInstrumentLink`, `chooseInstrumentLinkFamily`) first locks both files
in id order and checks them under the lock (`lockLinkDocuments`): the instrument a questionnaire or
codebook, the data file a raw data file, both in this project and not removed; matching reads the
questions under that lock from this project only, and its `instrument_for` update is scoped and must
change one row. A codebook from another project, or one in the bin, is refused with nothing written; a
confirmation waiting while the file is removed is refused. Removing a file moves its links with it
(`documentBin`), so restoring both files brings their links back, as they were, with no further step.
The researcher confirms; nothing is applied before that.

**Which data file (Grant, 27 October 2026).** A codebook or questionnaire is matched to the data file
it was matched to before; else, with no data file named, `chooseMatchTarget` (`instruments.ts`) picks
the only raw data file, or the one whose variables match the most of its items when that lead is clear
(at least 3 items and a quarter ahead of the next). Waves of one tracker usually fit equally, and a file
whose variables cannot be read cannot be compared: then nothing is matched, the card lists each file's
count and asks. It is never matched to "the first file" by default, and the Import list says "Linked to"
only for files it actually has links to (`InstrumentSummary.linkedDataDocumentIds`, suggested or
confirmed), plus the file it was last matched to. One questionnaire can be matched to several waves (choose
each on its card and Match); every one of them lists it and gets its labels. A read that failed shows
"Read failed" in the list, not "Not read yet".

**Dense questionnaires.** A part of the document whose questions and answer lists need more output than
one read returns (a ballot of 61 candidates) is read again in halves, split at a line (a page boundary
when one is near the middle), down to three times; only a half that still overflows counts as failed.
A read where every part failed says "None of this file could be read" with the reason; "No question
items were found" is kept for a read that worked and found none.

**Upload.** Add files offers "Codebook" (`.xlsx .xls .csv .tsv .txt .json .pdf .docx`); a name with
codebook, data dictionary or variable list suggests it, and a `.json` file is suggested as a codebook.
Questionnaires also take `.xlsx .xls .csv`. A data workbook's own Codebook sheet is still read with the
data file, as before.

**Pinned by** `codebookImport.db.test.ts` (Berkeley layout end to end to labelled categories; long
format; three JSON shapes; XLSForm with no model call; a non-codebook refused) and
`e2e/ui/codebook.check.mjs`.

**Limits.** A codebook variable whose name differs from the data column (renamed on export) is not
matched by name and falls back to wording matching. Value ranges and notes ("1 thru 58") are not stored.
XLSForm `relevant` expressions are kept as text only.

## Planned: the import module in order (Grant, 26 October 2026)

1. This batch: file formats (.txt, SAS, R, Parquet), the codebook type, Excel and XLSForm questionnaires,
   respondent checks.
2. A "Labels and documentation" tab per data file: codebook and questionnaire side by side. The codebook
   is the authority on variables (names, labels, codes), the questionnaire on questions (wording,
   routing, order). Labels in the order data file, then codebook, then questionnaire; a disagreement is
   shown, never chosen. Coverage: variables documented, variables not documented, codebook entries with
   no data column. **Done (LBL-01, b40):** see "Two documents for one data file" below.
3. An always-shown preview of the first rows, and one Variables editor (type, question type, label,
   missing codes, weight). It includes negatively phrased items (Grant, 26 October 2026): within a
   battery, suggest an item from its wording ("not", "never", "don't", "dis-", "un-") and from a negative
   correlation with the rest of the battery, stronger when both agree. The researcher confirms; the
   recode is a new derived variable from the scale's declared codes ((max + min) - code), missing codes
   untouched and the original column unchanged, with who confirmed it and on what evidence. Scale means
   and top-box then use the recoded item, and the straightlining check reports the same answer across
   reversed items separately, as a stronger sign of inattention.
   **Reverse-coded items done (b48, `reverseCoding.ts`):** suggestions per battery on the Data quality tab
   (respondent check: wording from `_REVERSAL_WORDING_RE` on the item label, the linked codebook's or
   questionnaire's where the file has none, and a negative item-rest Pearson correlation over at least 30
   cases, non-answer codes excluded; "both" when they agree). Confirming is a click: the battery and its
   scale (min and max of its declared points) come from the engine's reading, never the request; the
   derived variable `<name>_r` (or `_r2`... if taken) is computed by the engine as (min + max) - code on the
   scale's whole points, other codes and blanks kept; it takes the original's value labels, missing
   declarations and data-type correction, and its place in the battery (the original stays, out of the
   set). Stored on the variable's corrections with the evidence and time; undo removes it. If the derived
   variable can no longer be built (the file was replaced and now has its own column of that name, or the
   item now has text answers), using it fails with the reason, and the file's own column keeps its name in
   the variable list (b49).
   **Scales that cannot be mirrored (Codex B42-F01, batch 46R):** a reversal is refused at confirmation,
   with the reason and nothing saved, when the battery's usable points are not every whole number from its
   lowest to its highest (1, 3, 4, 5) or when a non-answer code (declared missing, or labelled don't know,
   refused, not applicable) lies inside that range: reversing over the range would move valid answers onto
   that code and drop them from the base (every 4 became 2, "Refused": base 35 instead of 47). The engine
   gives the reason per battery (`reversalProblem`, `_reversal_problem`) and the Data quality panel shows
   it instead of the Reverse button. Non-answer codes outside the range (9, 99) and blanks are kept as they
   were. A stored reversal is checked again on every read with the same rule (`_reversal_problem`, Codex's
   replay of B42-F01, batch 46R2): the item's scale now (its labelled answer codes in the confirmed range
   plus the codes it holds there) must still be every whole number of that range with no non-answer
   inside it, or the derived variable is not built and any use of it fails with the reason (a file
   replaced by one whose scale is 1, 3, 4, 5 no longer turns every 4 into a code 2 the scale lacks); undo
   recovers. A scale's points, at confirmation and on read, are the codes used plus its labelled answer
   codes in range (`_battery_scale_points`), so a fully labelled 1 to 5 scale on which nobody chose 2 is
   still full; an unlabelled item on which nobody chose a middle point reads as a gap and is refused. Tables that used
   the derived variable depend on the source's corrections (`correctionsFor`), so a change or undo marks
   them changed. The respondent check flags a respondent giving the same answer across items worded in
   opposite directions. Not yet: the always-shown preview and the single Variables editor.
4. A qualitative codebook (coding frame) at import, linked to the transcripts, which the Coding section
   starts from instead of inducing a codebook. With its own quality metrics:
   - counts: codes, themes, sub-themes, and the depth of the hierarchy;
   - completeness: codes without a definition, without inclusion or exclusion criteria, without an
     example quote;
   - structure: duplicate or near-duplicate code names, codes with no theme, themes with a single code,
     very uneven numbers of codes per theme;
   - after coding: codes never applied, and codes applied to most turns (too broad), feeding the codebook
     quality work in `claude/coding-module-learnings-2026-10-26.md`.
5. Gaps in reports and static tables, if Grant sees any.

"No opinion" stays a valid answer in political polling (Grant, 26 October 2026): it is not added to the
non-answer codes.

## Two documents for one data file (LBL-01, 26 October 2026)

- **Confirmation (IR-04, narrowed).** Within one document a variable is confirmed for at most one
  question (`variableTakenBy`, under the data file's lock). Different documents decide separately, so a
  codebook entry and a questionnaire question can both be confirmed for the same variable. Before this,
  whichever document was confirmed second was refused ("already confirmed for Q5"), and matching skipped
  the variables the other document had confirmed.
- **Precedence (`labelOverlay.ts` `resolveLabels`, `LABEL_SOURCE_ORDER`).** Variable and answer labels:
  the data file's own (the engine never replaces them), then a codebook, then a questionnaire, then a
  link with no recorded type; ties by upload order, then question order. Question wording for tooltips:
  questionnaire before codebook, since a questionnaire states the question as asked.
  `getConfirmedItemsForData` returns rows in this order (confirmed first), so stated routing and its
  gates follow it too.
- **Disagreements.** Where two documents give different answer labels for a variable (any code missing
  from one, or a label that differs apart from case and spacing), the stronger source's are applied and
  the pair is kept in `LabelOverlay.conflicts`. Unlike IMP-015 inside one workbook (neither label
  applied), a codebook outranks a questionnaire by Grant's rule, so a choice is made, and it is shown.
- **A source that labels one answer (B36-F07, 26 October 2026).** One labelled code on its own never
  makes a variable's answers labelled (a count question's "99 = Don't know" would turn it into a
  categorical one), so the base map is the strongest source that labels at least two answers. A
  stronger source's codes are never dropped for being few: each code a source ranked above the base
  gives takes precedence for that code (`valueLabelsOverriddenBy`), and where the base said something
  else for it, the pair is a conflict. A weaker source is compared on the codes both give (all codes
  when both are full maps), so its disagreement is listed, never applied. When every source labels only
  one answer, none is applied and the tab says so (`valueLabelsNotApplied`, `answerLabelsNote`).
- **Answer codes are identities as written (B36-F01).** The engine keeps a codebook's code as its text
  ("1.0", "1", "1e0", "AA" are four codes); only matching against the data column decides whether two
  codes are the same answer. On a numeric column "1.0" and "1" are one value, and two different labels
  for it are an IMP-015 conflict (`code [conflicting labels: "A" / "B"]`, `meta.label_conflicts`), never a
  silent choice.
- **The tab.** A raw data file's links tab is now "Labels and documentation"
  (`LabelDocumentationPanel.tsx`, `labelDocumentation.ts`): coverage tiles, the linked documents, the
  disagreements, a per-variable table (data file label, codebook entry, questionnaire question, where the
  label and answer labels come from) with filters and search, and codebook entries with no confirmed
  column (a suggestion waiting, or no match). Read only; it compares the file's own dictionary
  (`loadFileOwnVariableDictionary`, no overlay and no corrections) with the confirmed links, and refuses
  rather than reporting "not documented" when either cannot be read.
- **Freshness.** Unchanged: confirming a link has always changed the labels later tables use, and a
  table already built keeps its labels. A project whose second document was refused before can now
  confirm it; nothing changes until someone does.

## Questionnaire through the codebook (batch 49, 27 October 2026)

Grant: questionnaire 1A and codebook Q1 have the same wording, yet 1A was offered to Q1 at 63% and had
to be confirmed again. Cause: each document is matched to the data file on its own, and the
questionnaire's wording was compared only with the data file's short label for Q1, never with the
codebook's confirmed wording (and wording matches are capped at 89%).

- **Rule** (`instrumentMatch.codebookWordingMatches`, `normalisedWording`, `wordingIdentical`): a
  questionnaire question whose wording is identical to that of a codebook entry confirmed for a variable of
  the same data file is that variable. Identical means equal after formatting only (B49-F01, 28 October
  2026): NFKC, case, runs of spacing, the style of quotation marks and dashes, and closing punctuation.
  Symbols and signs ("<", ">", "+", "-"), numbers and every script are kept, so "< 5000" is not "> 5000"
  and "東京" is not "大阪". A leading question label is dropped only when unmistakable: the item's own code
  at the start, or a number label closed by ".", ")" or ":" ("1A.", "Q1)"); "18 years and older" keeps its
  18. At least five words; only unambiguous pairs. Close wording stays an ordinary suggestion.
- **Links made by the first rule** (which reduced wording to ASCII letters and digits): every reader checks a
  link through the codebook again with `wordingIdentical` (`getConfirmedItemsForData` leaves a failing one
  out; the card says "The wording is not identical to codebook Q1, so this link is not used"). Matching again
  turns such a link back into a suggestion (method `wording`); the next match works suggestions out afresh,
  as always. Links the researcher chose, confirmed or rejected are never touched.
- **Persistence** (`suggestInstrumentLinks`, migration 0125): written in the matching transaction as
  method `codebook`, confirmed, confidence 1, `basis_item_id` the codebook entry. It upgrades a suggestion
  for the same pair; a link the researcher confirmed or rejected is never overwritten; matching again adds
  nothing. A variable already confirmed for another question of the questionnaire is not taken.
- **Freshness** (`CODEBOOK_BASIS_HOLDS`, used by `getConfirmedItemsForData` and `getInstrumentLinks`): a
  link through the codebook counts as confirmed only while its codebook entry is still confirmed for the
  same variable of the same data file. Rejecting or re-linking the entry, or deleting it, withdraws the
  link from every calculation; the card says "The codebook no longer confirms Q1, so this link is not
  used" and choosing the variable again confirms it as the researcher's own.
- **Before 0125:** nothing is linked this way, the match says "Links through the codebook need migration
  0125", and confirmed meanings read as before.
- **Screens:** the tab is "Codebook links" for a codebook and "Questionnaire links" for a questionnaire;
  the links column is "Variable in <data file>", each link shows the variable's label, a link through the
  codebook reads "Identical to codebook Q1", the buttons read "Confirm: 1A is Q1" and "Not Q1", and a
  codebook entry with no column reads "No variable named w2 in <data file>".
- **Order:** the codebook's entries must be confirmed before the questionnaire is matched; matching the
  questionnaire again after confirming the codebook picks them up.

Tests: `codebookWordingMatch.test.ts` (Grant's two texts, close wording, too short, ambiguous both sides),
`codebookWordingLinks.db.test.ts` (real database: linked with its basis, idempotent, withdrawn with the
codebook entry and restored, a researcher's rejection kept, deleted basis), `codebookWordingLinksPre0125
.db.test.ts`, `e2e/ui/codebook-questionnaire-links.check.mjs`.

## A codebook linked to every wave, confirmed where the codes fit (CB1, 29 October 2026)

Grant: "a link of codebook is manual for each wave, i think it should be automatic". Before CB1 every codebook
entry was only suggested, one data file at a time, and with several waves nothing was matched until the
researcher chose a file.

- **Which files.** `matchCodebookToDataFiles` matches a codebook to every active raw data file it describes:
  - at least half of the codebook's named entries are exactly variable names in the file, and at least three
    (all of them in a smaller codebook), per `sharesCodebookNames`;
  - another study sharing a few names ("Q1", "age") is left alone and reported as such;
  - each file's outcome (matched, too few names, failed) is returned and shown, so a partial result never reads
    as complete, and one failure does not stop the others;
  - the codebook's default file is set only when it has none.
- **Waves added later.** `InstrumentSummary.unlinkedDataFiles` counts files with no link from the codebook. The
  page matches those once per page (`matchCodebookToNewDataFilesAction`, `onlyUnlinked`).
- **Confirmed without a click.** `suggestInstrumentLinks` confirms an entry automatically when both hold:
  - its code is exactly one variable's name (the matcher's unique exact-code rule, confidence 1);
  - its answer list covers every code the variable holds in the data (`answerCodesFit` against the dictionary's
    `codes`, which the engine records from version 16).

  Such a link is stored as method `code`, `decided_by = 'automatic'`. Unknown is never a fit, and the entry stays
  a suggestion when:
  - the entry has no answer list;
  - the variable is a measure, text, has decimals or has more than 60 values;
  - the dictionary predates the codes.
- **Re-checked.** Every match re-checks the automatic links: one whose name or codes no longer fit goes back to
  a suggestion. Read again re-checks them too (Codex E1-F04): an entry whose answer list or name changes in the
  read has its automatic confirmations withdrawn in the same transaction that saves the new items, so its new
  meaning is never used as confirmed unchecked; after the read, `matchCodebookToDataFiles` checks them on every
  wave, confirming again where the list still covers the codes. If that check fails they stay suggestions and Read
  again says so; a failed read changes nothing.
- **Per-wave outcome of the re-check (Codex E1R-F01, R3e1).** `matchCodebookToDataFiles` reports a wave it could
  not check as `files[].status = "failed"` (or `"few_names"` when the codebook no longer describes it) instead of
  throwing. `readInstrumentItems` judges `automaticRecheck` from those per-file outcomes, for the files that held a
  withdrawn confirmation:
  - every such file matched: `status: "done"`, `reconfirmed`, and `files` (an ordinary non-fit is part of a
    completed check and stays a suggestion);
  - any such file not matched: `status: "failed"`, `error` naming each file and its reason, `reconfirmed` from the
    files that were checked, and `files`. The checked waves' results stand; the unchecked waves' links stay
    suggestions;
  - the matcher itself threw: `status: "failed"` with its error and no `files`.

  The card's wording is `instrumentMatchMessage.automaticRecheckMessage`. It says "checked again against every wave"
  only for `done`; otherwise it names each wave not checked with its reason, gives the checked waves' result, and,
  for an operational failure, says to choose that wave under Data file and press Match again. The incomplete-read
  message carries the same sentence.
- **The researcher's decisions.** Any status the researcher sets records `decided_by = 'researcher'`:
  - matching never deletes, upgrades or confirms such a link, including one the researcher returned to a
    suggestion;
  - "Choose" by hand stores method `manual`, which the re-check never touches.
- **Before migration 0133.** Nothing is confirmed automatically and the match note says so. Waves are still
  matched, as suggestions.
- **Not yet.** A questionnaire item is linked through the codebook by identical wording (batch 49), not yet by
  the codebook's question number.
