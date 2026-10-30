# L2 conformance: codebooks, questionnaires and linking to data

Built 28 October 2026 against /home/claude/b66 (no app code changed). Every expected value comes from the truth the
file is generated from (`gen.py`), from a hand reading (IGS, World Bank Findex question map), or from the contracts in
`claude/`; none is copied from the app's output.

## How to run

| Runner | Command | Time |
|---|---|---|
| Engine codebook and XLSForm reading | `python3 conformance/l2/run_engine.py [id-prefix ...]` | about 5 s |
| Linking (real disposable PostgreSQL, local engine) | `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres npx vitest run conformance/l2/linking.db.test.ts --pool=forks` | about 60 s |

Results: `conformance/l2/results/engine.json`, `results/linking.json`, one row per case.

Case kinds: **contract** (settled by the contracts; mismatch is FAIL); **gap** (shape the contracts do not describe:
the correct reading, a refusal, or the items flagged unread pass; a silent wrong or partial read reported complete
fails, per standing requirements 1 and 7); **question** (recorded, never counted); **feature** (capability not
offered); **known** (planned batch 53 grid detection, recorded only).

Real: the engine in both runners; a disposable database per run; the library functions in `instruments.ts`,
`instrumentMatch.ts`, `documentBin.ts`; data dictionaries built by the local engine. Mocked: storage (in memory), the AI
model (returns hand-read questionnaire items), usage logging, Next cache.

## Counts (last run, 28 October 2026)

| Runner | Cases | Pass | Fail | Question | Feature gap | Known |
|---|---|---|---|---|---|---|
| Engine (`run_engine.py`) | 127 | 96 | 18 | 8 | 3 | 2 |
| Linking (`linking.db.test.ts`) | 48 | 43 | 1 | 2 | 0 | 2 |
| **Total** | **175** | **139** | **19** | **10** | **3** | **4** |

## Failures

### L052 (S2): rewording a confirmed codebook entry's label destroys its confirmed link on reread

Repro: codebook `Variable,Label,Values` with `q1,Would you recommend us to a friend?,"1=Yes, 2=No"`; data column `q1`;
match; confirm. Change only q1's label to "Would you recommend us to a friend or colleague?" and Read again.

Expected: the item is the variable q1 and its confirmed link survives (standing requirements 3 and 9;
`instrument-reread-coverage.md`; `codebook-import.md`: the item's code is the variable name).

Actual: the read is complete with 4 items, but the link `q1->q1` is gone. `storeInstrumentRows` keys items by code plus
the first 80 characters of the text, so a new label makes a new item and the old item is deleted with its confirmed
link. Knock-on: questionnaire links resting on that entry (batch 49) lose their basis; a questionnaire whose model
reading varies slightly between reads is exposed to the same mechanism. Confirmed don't-know codes stop applying, so
bases change.

### FX05 (S2): a question map's Filter (routing) column is stored as answer codes

File: World Bank Findex `indicator-mapping-by-economy.xlsx`. Expected: no answer codes (the file has none). Actual: the
engine picks the Filter column as the values column (most "=" cells); 77 questions get a false answer code (Fin13A
`Fin12_13 = "yes"`, Fin24A `Fin24 = "1,2,3,4,5, 6"`, Con10 `Con9 = "Basic text phone"`); 54 more are flagged unread
(`Fin1 or Fin2 = "yes"`), so the read is reported incomplete for a file with no answer lists. Clause:
`codebook-import.md` (values column chosen by content) against standing requirements 1 and 6. S2: the false codes never
equal real data codes, but stored meanings are wrong and the coverage warning is false.

### Engine: answer lists silently lost while the read is reported complete (S2)

Items return no codes and no `unreadValues`, so nothing tells the researcher the codes were there; a don't-know or
refused code in such a list is never applied, so bases change. Clause: `codebook-import.md` IS-F04 and standing
requirements 1 and 7.

| Case | Shape | Actual |
|---|---|---|
| E037 | long layout, no header (`q1,Would you recommend us?,1,Yes` / `...,2,No`) | one item per variable, no codes |
| E038 | long layout, header `Variable Name,Value Code,Value Label` | no codes; **the first answer label becomes the variable label** |
| E040 | SPSS "Variable Values" export: `,Value,Label`, variable only on its first row | as E038 |
| E115 | SPSS DISPLAY DICTIONARY workbook ("Variable Information" + "Variable Values") | labels right, no codes, header `Value` read as a variable |
| E095 | `{1, Yes}, {2, No}` | no codes, not flagged |
| E096 | `1. Yes, 2. No` | no codes, not flagged |
| E097 | `1: Yes, 2: No` | no codes, not flagged |
| E098 (S3) | `1 Yes, 2 No` | no codes, not flagged |
| E127 | values across columns: `Variable,Label,1,2,9` | no codes |
| E128 | `Code1,Label1,Code2,Label2` | no codes |
| E129 | codes on their own rows under the variable | no codes; **"2=No" and "2=Female" become section headings** |

### X004 (S2): XLSForm `select_one yn or_other` loses its choice list

`_xlsform_items` takes the last word of the type (`or_other`) as the list name; options `[]`, not flagged. Expected
1=Yes, 2=No. `or_other` is standard XLSForm (ODK, Kobo).

### Header and title rows read as variables (S3)

Clause: `codebook-import.md` IS-F07.
- E054: seven title rows above the header; "Codebook" and "Confidential" become variables (header search stops at row 6).
- E059: header `Varname,Description,Value labels`; "Varname" becomes a variable.
- E060: header `Var,Lab,Vals`; "Var" becomes a variable.
- E122: a multiple-response sets sheet `Set,Label,Variables` is read as a codebook (expected: skipped and named).
- FX01: Findex header `Indicator Name | Filter | Question | Key` not recognised (`_VAR_COL_RE` has no "indicator
  name"), so "Indicator Name" becomes a variable labelled "Question".

## Questions for Grant (recorded, not counted)

1. E110 / E111: a dictionary split over a Variables sheet and a Values sheet. First description wins, so labels or codes
   are dropped while the read says complete. Merge per variable? (The usual SPSS/Stata export shape: S2 if yes.)
2. E105: a name cell holding a range ("Q5_1 to Q5_8") is one variable named literally. Expand, refuse, or flag?
3. E062: a one-word heading alone on a row ("DEMOGRAPHICS") is read as a variable. Section or variable?
4. E114: a study-information sheet (Project / Fieldwork / Sample / Method) is read as four variables. Acceptable?
5. X003: an XLSForm select naming a list missing from `choices` gives empty options and a complete read. Flag?
6. IGS05: row 39 (`white, black, latino, asian, natam, other`) describes six 0/1 indicators; the engine gives each one
   code "1" with the whole sentence as its label. Leave, or treat as a note?
7. L013b: codebook Q1 with data columns q1 and Q_1. IS-F06 (offer at 0.8 for a choice) and the linking contract
   (separators ignored only when no column is equal) disagree; the app links q1 and never offers Q_1. Which holds?
8. L015: codebook entries q1 (first) and Q1, data column Q1 only: the case-folded q1 takes Q1 and the literal Q1 gets
   nothing. Should the literal entry win?
9. E102 / E113 / E022: conflicting duplicates are resolved silently (first wins). Report them?
10. FX02: footer tables under a codebook table (the Findex legend `Key | Countries Surveyed | List of Countries`) are
    read as variables "Key", "1" to "8". Should a second header row or a blank-row break end the codebook table?

## Feature gaps

- Long layouts with unrecognised or no headers, SPSS DISPLAY DICTIONARY exports (E037, E038, E040, E115).
- Answer lists other than comma-separated `code=label`: semicolons and line breaks are flagged unread (E074, E075;
  acceptable, but common); `1. Yes`, `1: Yes`, `1 Yes`, `{1, Yes}` silently dropped (failures above).
- Values across columns and codes on their own rows (E127 to E129).
- Dictionary split across two sheets (question 1).
- Multiple-response sets in a codebook column or sheet not kept (E121); an MR sets sheet misread (E122).
- Declared missing values in a codebook column not kept (E124).
- Routing or filter columns not kept as routing (FX06) and misread as codes (FX05). XLSForm `relevant` is kept.
- Header names outside the recognised set ("Indicator Name", "Varname", "Var").
- Ranges in name cells (question 2).
- Grid questions (batch 53, known): not grouped (E126, IGS07); a grid stem is not linked to its members (IGSL5). After
  the codebook is confirmed, IGS 5A is suggested for Q5_1 only, by wording at 0.89; confirming it would give 5A's
  meaning to one member of eight.
- Questionnaire numbering against Q-prefixed names: item "13" does not reach Q13_1 to Q13_14 (L037, known).
- XLSForm `or_other` (X004).

## IGS May 2026 (hand reading)

May26_codebook.xlsx: one sheet, 268 rows; header written the wrong way round ("VARIABLE LABEL" heads the names);
sections at rows 3, 23, 42; row 39 lists six names in one cell; 266 variables, no duplicates. Codebook names missing from
may2026.txt: `w2`, `generation`; no data columns missing from the codebook (264 columns). Q3 and Q3b are 62-code ballots
with commas and quotation marks in labels. Questionnaire 5A is a grid of eight candidates with codes 1 Favorable,
2 Unfavorable, 3 Dk/no opinion, matching Q5_1 to Q5_8.

Results: every IGS engine case passes; linking passes (264 exact suggestions, w2 and generation unlinked, 264
confirmed, 1A linked to Q1 through the confirmed codebook entry).

## World Bank Findex question map (hand reading)

Two sheets, Findex and Connectivity: header `Indicator Name | Filter | Question | Key`; 105 + 52 = 157 questions; then a
note row and a legend `Key | Countries Surveyed | List of Countries` (keys 1 to 8, and 1 to 4). Names carry trailing
no-break spaces (trimmed) and some inner spaces (`Fin 14 B`, kept). No answer codes: Filter is routing; Key points to
the legend of economies that asked the question.

| Case | Expectation | Result |
|---|---|---|
| FX01 | header row not a variable (contract) | FAIL S3 |
| FX02 | legend rows not variables (question) | differs: "Key", "1" to "8" read |
| FX03 | the 157 names in order, trimmed, inner spaces kept | PASS |
| FX04 | labels are the Question column | PASS |
| FX05 | Filter not stored as answer codes (gap) | FAIL S2 |
| FX06 | Filter kept as routing (feature) | not supported |

## Not covered

The model's reading of Word/PDF questionnaires and codebooks and of non-XLSForm spreadsheet questionnaires (the tests
supply the model's answer); Word-to-text conversion; label overlay outcomes in tables; the screens; link-write
concurrency (covered by existing tests); `tsc` on the conformance folder.
