# Handover: Import screen changes and the proposal re-read rule (main copy), 22 October 2026

Status: **implemented, ready for independent review.** Two changes Grant asked for on 22 October, main copy only; 3001 out of scope. The R1000 repairs stay accepted at `780b4b8`. Nothing pushed or deployed; no development or live database touched; **no migration**.

| Commit | What |
|---|---|
| `2ad3ece` | Import screen (design; one server change: View original downloads) |
| `650735c` | The same proposal is not read twice; Read it again only suggests (correctness) |
| this commit | Handover and status line |

Package hashes: `.fnd001/overnight/{m-import,m-reread}/hashes.txt`, zero committed-byte mismatches.

## Import screen (`2ad3ece`)

Grant's list (22 Oct 07:44), each done:
- Selected source and the file name on one line; type, upload date, wave and the purpose text on one line (5 lines to 3; `file-purpose-text` kept).
- View original downloads with no window: `openDocumentAction` takes `want: "download"`, signing the original as an attachment under its own name (PDFs included); anything other than view or download is refused; the ownership check is unchanged. `OpenFileButton mode="download"` follows the link through a plain anchor, not `window.open`. The accessible name is "Download <file>".
- Source list: a roll-up toggle (`source-list-toggle`, `aria-expanded`; search, filters and list keep their state; not remembered across reloads); type, state and sort on one row ("Sort: Newest first" and so on); links always named on the type and date line ("Linked: questionnaire.docx", "and N more"; a questionnaire shows "Linked to X").
- "Open Analysis" is "Open Crosstabs"; raw data also gets "Open Analytics" (`GoToSection secondary`, `RunShell.tsx`); aggregated tables get Open Crosstabs only, as Analytics needs case-level data.
- Preview: "Preview imported file". Setup and Variables selects at `text-xs`. "Variables to look at" is "Variables needing review".
- "Weights and missing codes" is now "Weights" (`DataAuditPanel part="weights"`); the missing-value check is a fold under Variables (`part="missing"`, `data-audit-missing`), same loading and reads, rules unchanged.
- Data quality: the long unmatched-label sentence is replaced by a "Value labels" row in the checks table (`ValueLabelsRow`) with the exact count of label-sheet variables not in the data and the conflicting-variable count, and a fold listing every name; the row is a Note and does not change the table status or the tab badge. `LabelDiagnosticsNotice` now handles conflicts only. Variable types sit between the overall stats and the checks.
- Questionnaire links: `QuestionnaireLinkingNote` on the data file's links tab and the questionnaire's own tab. It does not say figures never change: confirmed links show question wording and answer labels, and the questionnaire's don't-know codes are treated as missing, so bases and percentages can change; nothing applies until confirmed; the data file is never changed.

Checks: `import-file-detail` (download with no popup, links named, both buttons), `add-files-panel`, `scale-missing-reload` (the missing-value fold), `guide-auto-read`, `transcript-card`, `coding-switch`, `research-quality`: 8 of 8 with a screenshot pass (production build). Unit: `labelDiagnosticsNotice` (3), `documentOpen.db` (4, new download case). The Value labels row was not shown in screenshots (the fixture has no unmatched label sheets); it is covered by the unit test.

## The same proposal is not read twice (`650735c`)

Cause: each fill re-ran extraction; wording varies between reads, and the duplicate rule is exact after `objectiveIdentityKey`, so reworded lines came back.

- A fill from a document that an earlier successful fill of the project used (same document id, or another document of the project with the same `content_sha256`; by id only where that column is absent) calls no model and adds nothing; the save returns `already` (documents, first fill time, objectives that came from it) and the form says so; typed fields save. With a used and a new document chosen together, only the new one is read. The check runs again under the runs row lock, so of two concurrent fills of one new document one fills and the other returns `already`.
- "Read it again for anything new" (`rereadDocuments=1`) re-reads and adds only lines new by key and lineage, as `researcher_authored` candidates with status `pending` ("Waiting for review") and rationale `Suggested on re-reading the proposal "<file>"`; never accepted, never in the stated list. A failed re-read is recorded with `reread: true`, so Try the fill again re-reads too.
- `objectiveSimilarity.likelyRestates`: token-set Jaccard over the content words of the identity key (function words removed, trailing plural s dropped), threshold 0.5, best score wins, ties to the earlier candidate, against non-rejected objectives that are not themselves re-read suggestions. It only places a suggestion beside its likely match ("Looks like one you have" chip; "Looks like an objective you already have: ..." when open); it never merges or drops.
- Different documents fill as before; typed, edited, rejected and deleted objectives untouched.

Checks: `objectiveRereadSuggestions.db` (9, real PostgreSQL, extraction mocked to reword on the second read), `objectiveSimilarity` (3), updated lineage, brief-fill and form tests; full library 1,394 passed, 67 skipped. Browser on the final tree: `objective-reread` (new) plus `objective-gt500` (8; F01 and F02 now go through Read it again), `objective-setup-review-identity`, `objective-marker-variants`, `objective-regeneration-native`, `review-action-failure`, `setup-objective-save-failure`: 14 of 14; objective review acceptance passed. Previous-code controls: the 9 new db cases fail on `b93d70b` (same document read twice, same-content copy read, reworded duplicates added, concurrent fills both add); `objective-reread` fails on the previous code (no already message).

**Not run:** the full native browser suite on the exact tree `650735c`. Please run it.

## Limits

- A fill record for a document deleted since cannot be matched by content, so re-importing a deleted proposal fills normally.
- Similarity is lexical, for placement only; a reworded objective with different words is not flagged.
- Re-read suggestions' source shows on Review, not on Set objectives.
- The Review middle pane is narrow at 1280 px, so the similarity chip can be cut off on the right (existing pane sizing).
