# Batch 51 handover: repairs for the import stress review (27 October 2026)

Base: Batch 52R (`64eb1100`), on 52, 50R, 50, 49, 48 and 46R2. Status: implemented, ready for independent
review. Tier A. No migrations. Repairs IS-F01 to IS-F07: IS-F01 to IS-F06 from `independent-import-stress-review-2026-10-27.md`
(Codex, frozen at `bb5bf6cd`). B42-F01, which that review replayed as still open, was repaired in Batch 46R2
(the stored reversal is checked with the full scale-fit rule on every read); `bb5bf6cd` does not contain it.
Contracts: `claude/one-reader-import.md` (Delimiter), `claude/codebook-import.md` (Reading, Linking, Scope);
four registry rows. IS-F07 (from the extra 500, `independent-import-extra500-review-2026-10-28.md`) is in its own
section below. Codex's retained campaigns were replayed on this code (see Gates).

## IS-F07 (S2): the codebook's header row was read as a variable and could confirm the wrong variable

`codebook_items` found the header row (`header_row`) but still read it, and any title rows above it, as items, so a
header such as `Variable,Label,Values` produced an item "Variable", and a multiword header could be read as a
one-variable codebook and suggest or confirm the wrong data column. The header row and every row above it are now
skipped. Proof: `codebookWideLists.db.test.ts` IS-F07 cases (the header never becomes an item; the wrong-variable
confirmation from Codex's case no longer happens; one-variable codebooks with multiword headers are still read).

## IS-F01 (S1): a short row made a delimited file import as one column

Cause: `_sniff_delimiter` returned a comma whenever `csv.Sniffer` could not decide, and a supported short row
was enough to make it give up on a semicolon, pipe or tab `.csv`.

Repair (one rule, `_sniff_delimiter`): each of `,` `;` tab `|` is read quote-aware over the first 5,000
records. A candidate fits when it splits the header into two or more columns and no later row has a non-empty
value beyond the header's width. One fits: that one. Several: the one with more full-width rows; equal counts
are refused as ambiguous, naming both separators ("Nothing was imported; save it again with one separator").
None fits but one splits the header: that one, so `_csv_grid` refuses the surplus row with its line instead
of publishing one merged column. Nothing splits the header: a genuinely single-column file, read with a
comma. Codebooks and other documents are ragged, so they take the candidate that splits the most rows and are
never refused for it (`ragged=True`). `.tsv` stays tab.

Proof (`delimiterChoice.db.test.ts`, the actual `extractAndStoreDocumentTables` and `loadCategories` on a real
database and engine, 6 cases; 5 fail on Batch 50, the single-column control passes on both): Codex's exact
source gives headers a, b, c and row 2 = 4, 5, missing, and reading it again gives the same table; pipe and
tab `.csv` and a `.tsv` control; a quoted separator, a trailing empty value and decimal commas stay in their
cells; a single-column file; surplus semicolon and pipe values refused with the line, nothing stored; an
ambiguous file refused, the corrected file then imports.

## IS-F02 (S1) and IS-F04 (S2): a wide codebook's answer list

Cause: `_cb_pairs` converted every whole-number code through a float (`01` became `1`, 9007199254740993
became ...992), and its pattern took only numbers, so `AA=Yes` gave no answers while the read reported itself
complete.

Repair (`_cb_list`): codes are kept exactly as written through `_cb_code`, the rule the long and JSON layouts
already use (B36-F01); whether `1` and `1.0` are one answer is still decided against the data column when the
labels are applied. A code is a quoted text or a run with no space, comma, "=" or quotation mark (`AA`, `A_B`,
`C-D`, `1e0`, `-9`, `1.5`). A quoted label may hold commas. A cell with "=" that is not such a list (`=Yes`,
`1=Yes 2=No`) is an unread list: the engine returns it as `unreadValues`, the item keeps no answers, the read
is reported incomplete (`incompleteItems`), and the item does not replace an earlier complete reading of it
(the same protection as a truncated list). "as is" is not a list. The values column is found by its lists,
read or not, so an unreadable column is still reported rather than taken for a label.

Proof (`codebookWideLists.db.test.ts`, the actual read, match, confirm, `loadCategories` and `buildCrosstab`,
4 cases, all fail on Batch 50): Codex's oracle, raw answers 01, 01, 1, 2 with `01=Refused, 2=Yes`: categories
Refused 2, "1" 1, Yes 1, and the saved table's base 2 with Yes 50%, identically for wide CSV, wide Excel and
JSON; a large integer code keeps its digits; text, underscore/hyphen and exponent codes and a quoted comma
label label the data; an unreadable list is reported incomplete (2 items), then the corrected file reads
completely.

## IS-F05 (S2): codebook names the data reader accepts were dropped

Cause: `_CB_NAME_RE` (an ASCII letter and 63 characters) decided which names were kept in every layout, and in
the wide layout which column held the names, so `Age years`, `回答`, `_Q1` and `123` were dropped silently, and
with such names the labels column could be taken for the names (the failing run on Batch 50 shows exactly that).

Repair: names are kept exactly as written (`_cb_name`: any text up to 256 characters with no line break) in
the wide, long and JSON layouts and in XLSForm. The pattern now only finds the names column and splits
`Q1, Q2`. The names column is the one a header names, unless that column has almost no one-word cells (under
20%) while another is mostly name-like (60% or more): the Berkeley IGS codebook's header is the wrong way
round, and its retained test still passes. A single filled cell that is not name-like is a section heading.

Proof (in `codebookWideLists.db.test.ts`): `Age years`, `回答`, `_Q1`, `123` read, linked by name and labelled
in the tables, under a section heading. Limit: a one-word capitalised line ("DEMOGRAPHICS") is still read as
a variable with no label, as before.

## IS-F03 (S1): a codebook from another project or the bin could be matched and confirmed

Cause: matching read the instrument's items by id alone and wrote `instrument_for` by id alone (Batch 49 had
added a run check, but after deleting suggestions); confirmation checked the link's run but not where its
question's document was; the meaning reader took every confirmed link of the data file.

Repair (one rule each):

- `LINK_ENDS_ACTIVE`: a link counts only while its question, the question's codebook or questionnaire, and the
  data file are all in the link's own project and none is removed. Used by `getConfirmedItemsForData` (every
  table's meanings) and by a codebook link's basis (`CODEBOOK_BASIS_HOLDS`).
- `lockLinkDocuments`: every write that creates or confirms a link (`suggestInstrumentLinks`,
  `setInstrumentLinkStatus` to confirmed, `confirmInstrumentLinks`, `chooseInstrumentLink`,
  `chooseInstrumentLinkFamily`) first locks the instrument and data files in id order and checks under the
  lock that each is an active file of the project (the instrument a questionnaire or codebook, the data file
  raw). Removal takes the same row lock, so a confirmation waiting on it sees the result. Matching then reads
  the questions under the lock from this project only, and its `instrument_for` update is scoped and must
  change one row. It replaces `lockDataDocuments`.
- Restoring both files from the bin brings their links back (the bin already moves links with a file); they
  count again with no further step.

Proof (`instrumentScope.db.test.ts`, real database and engine, 5 cases; 3 fail on Batch 50, on the
confirmation and race steps): another project's codebook refused at matching with nothing written, and a
stale suggestion refused by single, bulk and hand confirmation; a confirmed link left from an earlier version
is not used (base 4, not 2); a binned codebook refused, its links not counted, restored and confirmed it
applies (base 2), removed again it stops counting (base 4); a confirmation waiting on the codebook's lock
while another connection removes it is refused and nothing is confirmed; another tenant refused; one codebook
linked to two waves of this project still works, and a retry confirms nothing new. `instrumentConfirmCollision`
now expects the shared refusal wording for a wrong-project bulk confirmation (same behaviour).

Limit: run as the database owner with the tenant context, not under Codex's restricted NOBYPASSRLS role.

## IS-F06 (S2): an item was bulk-confirmed to several columns

Cause: `exactCodeVariables` returned every column equal to the code once case and separators were set aside,
and each was offered at confidence 1.

Repair: the column written exactly as the code wins (as written, then after NFKC and invisible characters);
when none is, every candidate is offered at `AMBIGUOUS_CODE_CONFIDENCE` (0.8), below "Confirm same-code
matches", for the researcher to choose. One column differing only in case or separators is still a confident
match, and families are unchanged.

Proof: `instrumentMatch.test.ts` (3 new cases, 2 fail on Batch 50: q1/Q1 in either order, Q_1/Q.1, Q1/Ｑ１;
the ambiguous pairs; the unchanged single-column and family controls) and case 5 of `instrumentScope.db.test.ts`
(a codebook q1 with columns q1 and Q1 is bulk-confirmed to q1 only).

## Why the earlier tests missed these

The delimiter tests had no short row; the codebook tests used the long and JSON layouts for code identity and
ASCII names only; the scope tests covered another tenant and another run's link but not a source document from
another project or the bin; no matching test had two columns differing only in case.

## Impact checklist

1. Rules: owners used and named in the registry (four new rows); `_cb_code` reused for codes; no second rule.
2. Inputs: an ambiguous separator or an unreadable answer list is reported, never guessed; an inactive file
   refuses the write; unknown never becomes a confirmed link.
3. Persistence: link writes lock both files in id order and recheck under the lock; the target update is
   scoped and checked; retries add nothing.
4. Freshness: tables built after the repair use the corrected meanings. Not examined in this batch: whether a
   table already saved with meanings from a link that is now inactive (one made through a stale or crafted
   request before this repair) is marked stale; removing a file to the bin marks what is drawn from it, as
   before. A codebook reread with codes now kept as written changes its labels; earlier tables are not
   rebuilt by this batch.
5. Screens: the refusals read "not in this project: it may have been removed to the bin. Nothing was changed."

## Gates

Commit `4d4befd` (this batch on Batch 52R `771115a`).
- `npx tsc --noEmit`: exit 0; `npx eslint .`: 0 errors.
- `python3 scripts/crosstab_selftest.py`: all checks passed.
- Library (`TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`): 268 files passed, 1 skipped;
  1,982 tests passed, 82 skipped, 0 failed.
- New and related browser checks: codebook, codebook-questionnaire-links, codebook-waves, flipped-codebook-guard:
  4 passed.
- Full browser suite (`npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1`): 134 passed, 1 skipped,
  0 failed (40.9 min). Smoke: 1 passed.

Replay of Codex's retained campaigns on this code (the same engine and instruments files as `4d4befd`; Codex's harness
and expected values unchanged, only its path to the app pointed at this code):
- `import-new1000` (pinned 45ce6002: 874 passed, 126 failed): engine 800 of 800 passed; database 200 of 200
  passed. The regenerated catalogue equals Codex's except the hashes of binary fixtures (Excel, SPSS and Parquet
  carry write timestamps); every expected value is identical.
- `import-extra500` (where IS-F07 was found): engine 400 of 400 passed; database 100 of 100 passed; the header
  identity case 1 of 1 passed.
