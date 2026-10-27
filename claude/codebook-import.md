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
  - Columns are found by content: a column of name-like cells (60% or more), a column of
    `<code>=<label>` lists (20% or more), and the longest remaining text column as the label. Header text
    is not trusted for this layout: the Berkeley IGS Poll codebook heads its name column "VARIABLE
    LABEL".
  - A value starts only at `<code>=` at the start or after a comma, so commas inside a label stay.
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

**Linking.** Unchanged: `suggestInstrumentLinks` matches the item code to the variable name exactly
(confidence 1), so a codebook's variables are strong matches; "Confirm same-code matches" confirms them.
The researcher confirms; nothing is applied before that.

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
   the variable list (b49). Tables that used
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
