# Import screen: sources, opening and downloading originals, and the data-file checks

The Import screen lists the files of a project and shows one selected file (`TranscriptSetup.tsx`,
the file detail in `src/app/runs/[id]/page.tsx`). This brief records what it promises since Grant's
changes of 22 October 2026 (`2ad3ece` on the main copy) and the limits of those promises. Rules for
filling objectives from a brief or proposal are in `objective-identity-and-import-lineage.md`.

**Source list.** The list rolls up with `source-list-toggle` (`aria-expanded`). Rolling it up only
hides it: search, filters and the list keep their state; the rolled state is not remembered across
reloads. Type, state and sort sit on one row (the sort shows as "Sort: Newest first" and so on).
Each file's links are named on its type and date line ("Linked: questionnaire.docx", then "and N
more"; a questionnaire shows "Linked to X"), so a link is visible without opening the file. Links
are shown from the stored link rows; the list does not change them.

**Selected file.** The header gives the file name on one line and the type, upload date, wave and
purpose text (`file-purpose-text`) on the next. Raw data offers Open Crosstabs and Open Analytics
(`GoToSection secondary`, `RunShell.tsx`); an aggregated table offers Open Crosstabs only, because
Analytics needs case-level data. The preview is titled "Preview imported file".

**Viewing versus downloading the original.** `openDocumentAction(runId, documentId, want)`
(`src/lib/documentOpenActions.ts`) signs a short-lived (600 second) storage link, after checking on
the server, under the signed-in tenant, that the document belongs to this project and organisation
(`id`, `run_id` and `tenant_id` in one query). A document id from another project or organisation
gets "That file is not in this project." and no link. `want` is `"view"` or `"download"`; anything
else is refused before any read.
- `view`: a stored PDF copy, or an original PDF, is signed for viewing in a browser tab; anything
  else is signed as an attachment under its own name.
- `download` (View original): the original as uploaded is always signed as an attachment under
  `source_filename`, PDFs included. The stored PDF copy is never substituted for it.
The original is never changed or copied by either path. `OpenFileButton mode="download"` follows
the signed link through a plain anchor with `download` set, so no window is opened and the page
stays where it is; its accessible name is "Download <file>". `mode="view"` opens the tab inside the
click (so it is not blocked as a pop-up), points it at the link once the server answers, and
closes it on failure; with pop-ups blocked it opens the link in the same page.

Failure and retry: a refused or failed signing (storage error, no link returned, or the server
call interrupted) is shown under the button as an alert with the reason, nothing downloads, and
pressing the button again is the retry; each press signs a new link. A link expires after 600
seconds, so a forwarded link soon stops working.

Limit: the attachment behaviour depends on the storage service returning a `Content-Disposition:
attachment` header for the signed `download` query. The application and SDK side (the signed URL
carries the original filename, the bytes are the original's) and the browser behaviour (no popup,
the page kept, failure then retry) were checked against a synthetic storage server plus a fixture
that supplies only that header (Codex, 22 October 2026). Deployed Supabase response headers have
not been certified.

**Data-file checks.** The tab once called "Weights and missing codes" is now two places, both from
one `DataAuditPanel` and the same read of the file (`loadVariablesAction`, cached after the first):
- the Weights tab (`part="weights"`), read when the tab first comes into view, not when it mounts;
- a fold under Variables (`part="missing"`, `data-audit-missing`) for don't know, refused and not
  applicable codes, read when it is opened.
The detection rules are unchanged. A failed read shows its error in the panel; the panel reads once
per mount, so the recovery is to select the file again or reload.

**Value labels.** Label-sheet diagnostics are a "Value labels" row in the data-quality checks table
(`ValueLabelsRow`, `ImportQualityPanel.tsx`): the exact count of variables in the label sheets that
are not in the data (their labels are not applied), with every name in a fold, none dropped, and the
number of variables with conflicting labels. It is a Note: it does not change the table's status or
the tab's count. `LabelDiagnosticsNotice` now covers conflicts only. The counts come from the
engine's `unmatchedLabelVariables` and `labelConflicts`.

**Questionnaire links.** `QuestionnaireLinkingNote` (`AttachedInstruments.tsx`) on the data file's
links tab and on the questionnaire's own tab says what a confirmed link does: tables and charts
from the variable show the question wording and answer labels, and codes the questionnaire marks as
don't know are treated as missing, so bases and percentages can change. Nothing applies until a
link is confirmed, and the data file itself is never changed. It does not claim figures never
change.

**Tests.** `documentOpen.db.test.ts` (real PostgreSQL, storage stubbed; ownership, view, download
including a PDF and a PDF copy, a storage failure reported; the refusal of another `want` is in
the code, not tested), `labelDiagnosticsNotice.test.tsx` (the row's counts, every name kept, Note only);
browser `import-file-detail` (download with no popup, links named, both buttons), `add-files-panel`,
`scale-missing-reload` (the missing-value fold), `guide-auto-read`, `transcript-card`,
`coding-switch`, `research-quality`.

**Limits.** Deployed storage headers are not certified (above). The Value labels row is covered by
the unit test only; the browser fixture has no unmatched label sheets. The source list's rolled
state is per page load.
