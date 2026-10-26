# Handover: technical documents for the Research assistant, its weighting answer, transcript coding wording, later additions (main copy), 24 October 2026

Status: **implemented, ready for independent review.** Main copy. Grant's requests of 24 October
(08:53, 09:18, 09:22). Follows the dashboards merge and batch16. **Migration 0112** (Grant applies it
in Studio). Nothing pushed or deployed.

| Commit | What | Kind |
|---|---|---|
| `f35034f` | Technical documents (upload type, reading, assistant tools); describe_weighting; transcript "Coding incomplete"; later additions | feature, wording, correctness of an assistant answer |
| `4224d5d` | M-B16-01 (stage-status brief) and M-B16-02 (superseded imports), from Codex's dashboards/batch16 review | documentation, dead code |
| docs commit | This handover and the status line | |

## 1. Technical documents (Grant, 09:22: "a technical documents selection option, at this stage for the assistant to read")

- **Migration 0112** (`0112_technical_documents.sql`): the documents kind check gains `technical`.
  Additive. Without it an upload is refused with "Technical documents need the database update
  0112_technical_documents.sql. Nothing was stored" (the insert rolls back and the stored object is
  removed through the existing cleanup path); nothing else changes.
- **Upload** (`uploadPurposes.ts`, `documentUpload.ts`, `documentUploadActions.ts`): a "Technical
  document" type (.pdf, .docx, .txt) in Add files, listed with the context files, suggested from names
  such as "Technical Report", methodology, fieldwork, sampling, weighting or survey design (checked
  before the report rule). Its text is read on upload like a brief; status ready, or failed when no
  text can be read. Project processing reads one with no text again (and fails it visibly) instead of
  stamping it ready. Not mined for findings; no Research quality role.
- **Sources** (`importSources.ts`, `runs/[id]/page.tsx`): "Technical document", with a line saying
  the Research assistant reads and quotes it, that it is not mined for findings, and that what it
  describes is not checked against the data; counted in the project totals.
- **Research assistant** (`technicalDocuments.ts`, `researchAssistantTools.ts`, `researchAssistant.ts`,
  `assistantLoop.ts`): the project's technical documents are listed by name in its context;
  `search_technical_documents` and `read_technical_document` search and read their text as numbered
  passages (about 1,500 characters on paragraph boundaries; extracted text has no page numbers, so a
  passage is "n of m"), this project's only, using the Knowledge base's word-matching rule (shared
  from `helpIndex.ts`). A failed read of the documents is an error result, never "none". Each reply
  ends with a code-written line "Technical documents read for this answer: <name> (passages ...)".
  The instructions say to quote or closely paraphrase, name the document, say it is the document's
  claim and not checked against the data, and say when nothing covers it.
- **Help**: Knowledge base Import kinds table and Research assistant page ("Questions about how the
  study was done"); index regenerated.

## 2. The assistant's weighting answer (the related open fix in `docs/later-additions.md`)

It told a researcher FinScope SA 2024 had no weight variable: weight variables are deliberately
hidden from `find_variables`. New tool `describe_weighting` (one data file of this project): its
weight variables, the default tables use (`defaultWeight`), the saved or detected survey design (or
that none is set, with ambiguous candidates), or that the set-up could not be read; and that Analytics
uses weights only. The instructions say to use it before saying anything about a file's weighting.

## 3. Transcript "Coding incomplete" (Grant, 08:53)

`importSources.processingLabel`: a transcript's partial state (some coding batches came back without
every passage coded; its text was read in full) reads "Coding incomplete", in the list and the
selected source, with a note to open Coding and run Code themes again; other files keep "Partly read".
The Prepare dashboard item for it reads "Coding of X is incomplete: run Code themes again for it" and
opens Coding. The coding list's tooltip names the real button ("Run Code themes again").

## 4. Later additions (Grant, 09:18)

`docs/later-additions.md`: SAS files and columns-as-cases with a separate Codebook (both earlier
owner-approved exclusions), and weights and survey design from a separate file joined by respondent
ID with composite strata (raised with the FinScope weighting workbook and R script), each with what is
supported now, the workaround and what it would need.

## 5. Knowledge base (Grant, 24 October: "update the knowledge section with all the recent changes as well as the technical docs, plan")

- New pages: "How the dashboards and stage status work" (`content/dashboards.tsx`: the five states, the
  main dashboard, section overviews and status lines, how a state is decided, files still in storage,
  limits) and "Planned, and not yet supported" (`content/roadmap.tsx`: SAS, variables-in-rows with a
  separate Codebook, weights and design from a separate file with today's workaround, more uses of
  technical documents), both registered in `registry.tsx` and `articles.ts`.
- Updated: Import (the Technical document kind, the file processing states including "Coding
  incomplete", the technical documents section); Findings (what happens when a save is refused or
  fails); Cross tabs (a Limit: one cluster and one stratum variable); Research assistant (questions
  about how the study was done, what it does and does not do with technical documents).
- `docs/later-additions.md` item 3: the engine's design standard errors were already checked against
  R on FinScope 2024 (within 0.3%, engineering brief v19 section 8.4), with the strata prepared outside
  the app; an earlier draft said they had never been compared, which was wrong.
- Help index regenerated (23 pages). Both new pages opened signed in on the production build at 1280
  px: they render, appear in the guide list, no page errors.

## 6. Codex's S3 findings from the dashboards/batch16 review (M-B16-01, M-B16-02)

- M-B16-01: `claude/stage-status.md` now says the group heading folds and unfolds the group and does
  not open the overview (the prototype's heading link was not merged), describes the browser check
  as the overview being each group's first entry with the heading folding it, and records the main
  dashboard's 25-newest-project bound, the older rows' "open the project" note and the Projects
  tile's note. It also says the bound has no retained test (Codex's independent check covered it).
- M-B16-02: the superseded `unscoredReasonFor` and `unscoredReasonText` imports are removed from
  `runs/[id]/page.tsx`; the shared rule `projectStageFacts.objectiveUnscoredReason` is unchanged.
  Lint on that file: 0 errors, 7 warnings (9 before; the remaining 7 predate batch16).
- `npx tsc --noEmit` passes on the tree with both.

## Not in this batch

TP500-F01/F02/F03 and IP1000-F01 to F04 stay open. Grant decided on 24 October (14:31) that they are
repaired by making the Python reader the one reader for CSV and Excel previews, as it already is for
SPSS and Stata, in a later batch. The fix for the CSM dashboard's duplicate table number (Grant,
13:07) goes with it.

## Tests

- `technicalDocuments.test.ts` (new, pure): passage splitting (grouping, sentence and hard cuts, no
  text lost, blank text, Windows line ends); search ranking and stems; passage refs (valid, out of
  range, fractional, other document, malformed); name suggestions (technical before report); label and
  group.
- `technicalDocumentUpload.db.test.ts` (new; real database, actual upload action and reader, storage
  stand-in): a text document stored as technical, read, ready, and found by the assistant's search; an
  unreadable PDF kept with status failed and not offered for search; before 0112 refused with nothing
  kept (no row, object removed, no pending cleanup), and added once 0112 is back.
- `researchAssistantTools.db.test.ts`, 3 new cases (real database, actual assistant loop, scripted
  model): search and read of this project's technical document with the passage quoted to the model,
  another project's passage refused, the reply's "Technical documents read" line, the context listing;
  no technical documents said plainly with nothing listed; `describe_weighting` with the default
  weight, a found-nothing design, an explicit design, an unreadable set-up and another project's file.
- `importSources.test.ts`, `stageStatus.test.ts`, `uploadPurposes.test.ts`: the transcript label, the
  dashboard item to Coding, the new type in the Add files order.
- Browser (new): `technical-document.check.mjs` (suggested type, upload, Technical document, Read, the
  purpose line, the preview text, the project totals, the type filter) and
  `transcript-coding-incomplete.check.mjs` (list and header label, the note, the dashboard item, and
  "Read" again once complete). Screenshots inspected.
- Mutation checks (each made, run, reverted): technical documents read without the project scope
  fails the assistant test; dropping the "Technical documents read" line fails it; dropping the 0112
  message fails the upload test.

## Checks run

Cloud workspace, disposable PostgreSQL 16 with all migrations to 0112, real Python engine,
production build, model replayed. Tree: `be2febf` (the code and Knowledge base content of this batch).

| Gate | Result |
|---|---|
| Full library | exit 0; 1,608 passed, 72 skipped (213 files, 1 skipped); no `Errors` line, no unhandled errors |
| Full native browser suite | 96 passed, 1 failed, 1 skipped (the gated real-model test). The failure, `data-setup-hydration.check.mjs` (the Setup tab not selected after a click while the page's scripts were held back), passed 3 of 3 runs alone on the same build; recorded as timing-dependent under the full run's load. This batch does not change that screen's setup code |
| Golden-thread smoke; objective acceptance | passed; passed |
| New browser checks: `technical-document`, `transcript-coding-incomplete` | passed; screenshots inspected |
| `npx tsc --noEmit`; lint on changed files | pass; no errors (one unescaped apostrophe in `dashboards.tsx` found by this lint run and fixed). `runs/[id]/page.tsx` has 9 unused-import warnings that predate this batch (none of those lines changed) |

## Limits

- Passages are cited by number, not page: extracted text keeps no page numbers.
- Search is plain word matching (no synonyms); the assistant is told to search again with other words.
- Technical documents are read only by the assistant; the methodology summary, objective evidence and
  design set-up do not use them yet. What a document describes is never checked against the data.
- The assistant outside a project has no technical documents.
