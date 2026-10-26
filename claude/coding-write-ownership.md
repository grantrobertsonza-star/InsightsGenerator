# Coding writes: whose transcript, which project

Codex COD500-F01 and COD500-F02 (2026-10-24).

Row-level security does not decide whose transcript a coding write names. An insert carries the
caller's own tenant id and is accepted whatever `document_id` it names; the foreign key checks only
that the document exists. So every coding write now confirms its transcript first, through one helper,
`lockOwnedTranscript(client, tenantId, runId, documentId, mode)` (`src/lib/codingTranscriptOwnership.ts`):
`select id from documents where id = $1 and run_id = $2 and tenant_id = $3 for <mode>`, refusing with
"That transcript is not in this project." before anything is written.

| Writer | Lock | Why |
|---|---|---|
| `codingMeta.saveCodeMeta` (theme, note, keywords per code) | share | the document cannot be deleted or moved to another run before the write commits; two annotation saves on one transcript run side by side |
| `codingMeta.saveTurnNote` (note on one turn, also clearing it) | share | as above; a negative or fractional turn index is refused first |
| `codingOverrides.changeTurnCode` (a hand change to a turn's themes) | update | the code is checked against the codebook version in force while no new version can be inserted; the override records this run |
| `codingOverrides.addResearcherCode` | update | as above |
| `codingOverrides.restoreCodebookVersion`, `extractThemes.insertCodebook` (every new version) | update | serialise with the hand changes above |

**Operations (Codex B21-F01).** A hand change to a turn's themes is "add" or "remove" and nothing else:
`parseTurnCodeAction` is checked in `changeTurnCode` and in `changeInTx` before anything is read or
written, because a server action's argument is not checked by its TypeScript type (an empty, null or
differently cased value used to be treated as remove).

Callers pass the run: `saveCodeMetaAction`, `saveTurnNoteAction`, `changeTurnCodeAction` and the
internal callers in `extractThemes.ts` (theme grouping, coded import) and `codingMemos.reuseCodebook`.

**Rows left by the old code.** A row another tenant stored against a transcript before this change is
invisible to the owner but still holds its key (`(document_id, code_key)` or `(document_id,
segment_index)`); the owner's upsert is then refused by row-level security (42501). That is reported as
"This could not be saved: the transcript holds a stored entry under the same name that this account
cannot see. Ask an administrator to remove it, then save again." and the whole save rolls back. Such
rows are found, as the database owner, with
`select m.* from coding_code_meta m join documents d on d.id = m.document_id where m.tenant_id <> d.tenant_id`
(and the same for `coding_turn_notes`). No migration.

**Tests.** `src/lib/__tests__/codingOwnership.db.test.ts`, real PostgreSQL connected as a NOSUPERUSER,
NOBYPASSRLS role: foreign tenant and wrong project refused for both annotation kinds with nothing
written; first save, key update, two saves at once, clearing; a foreign old row reported and the batch
rolled back, then the owner saves once it is removed; turn changes refused for wrong project, foreign
tenant, moderator turn, missing turn, obsolete code; add and remove record this run; a change waits for
a new codebook version being written and is then refused against it.
