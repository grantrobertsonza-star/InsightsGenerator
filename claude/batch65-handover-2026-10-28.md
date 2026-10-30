# Batch 65 handover: one output set per selection across a lost first reply (28 October 2026)

Base: `d47fdf1` (branch upload-identity). Status: implemented, ready for independent review. Tier A (grouping of
statistical output in storage, a migration). Finding: B52-F01, the part Codex found open on Batch 52R.

## What was wrong

The dialog learnt the set id only from a reply. When the first request's write committed and its reply was lost, the
unsent files were retried without a set id and the server started a second set: [A] and [B,C].

## The repair

- The dialog makes one selection id (`crypto.randomUUID`, with a `getRandomValues` fallback for a plain-http address)
  before the first request that carries statistical output, sends it as `outputSelectionId` with every such request,
  and keeps it on unsent output files after any failure.
- Migration **0129** adds `output_sets.client_selection_id` (unique per tenant where not null). `ingestOutputFiles`
  (the grouping owner) resolves the set in `resolveOutputSet`: insert on conflict do nothing, then select, scoped by
  tenant and project; the first request creates the set, any later or retried one joins it. An `outputSetId` that is
  not the selection's set is refused; a set made before 0129 is claimed by the selection naming it. A binned or
  foreign set of the selection is refused (unique per tenant rather than per project, so a late retry after binning
  finds the binned set and is refused instead of starting a new set). Families recomputed over the whole set.
- **Before 0129** (detected through `information_schema`): behaviour as 52R. After a lost reply with no set id yet,
  the dialog flags the rest (`outputSelectionUnconfirmed`) and the server refuses them, saying migration 0129 is not
  applied, that no second set was started, and to reload, check and upload the missing files as a new set. The full
  repair needs 0129.
- Separate: a failed storage write now names its network cause (`StorageWriteError`, `storageFailureCause`): message
  "Upload of X failed: fetch failed. The connection reported: UND_ERR_SOCKET, ...", and `cause: {code, message}` in
  the `upload_error` trace. Addresses and tokens are replaced. Without a cause the message is unchanged.

## Impact checklist

1. Rule: `ingestOutputFiles` owns grouping (registry row added); contract `claude/output-set-integrity.md`, "One
   selection, one set".
2. Inputs: malformed selection id refused; unknown outcome after a lost reply is never treated as "no set".
3. Persistence: set resolved and locked in one transaction with tenant and project in every predicate; per-file
   insert still holds the set FOR SHARE; unique index makes concurrent first requests converge; an all-failed
   request removes only an empty set it created, and a retry recreates it.
4. Freshness: none beyond 52R.
5. Screens: no "added" before the reply; retry without reload continues the set.

## Files

`supabase/migrations/0129_output_selection_identity.sql`; `src/lib/outputIngest.ts`; `src/lib/documentUploadActions.ts`;
`src/lib/documentUpload.ts`; `src/app/runs/[id]/AddFilesPanel.tsx`; tests `outputSelectionIdentity.db.test.ts`,
`outputSelectionPre0129.db.test.ts`, `storageFailureCause.test.ts`; browser check
`e2e/ui/output-selection-lost-reply.check.mjs`; docs `claude/output-set-integrity.md`, `claude/rules-registry.md`.

## Proof (real disposable PostgreSQL, storage mocked)

- `outputSelectionIdentity.db`: 8 passed (stored-but-lost reply, before-write failure, later lost reply, sequential,
  two at once, two selections separate, binned and foreign refused, mismatch refused, pre-0129 set claimed, storage
  cause recorded). On base code: 6 failed, 2 passed (before-write and two selections already held).
- `outputSelectionPre0129.db`: 1 passed; on base: 1 failed. `storageFailureCause`: 2 passed; on base: 2 failed.
- Related: outputSetAcrossRequests.db 3, uploadIdempotency.db 3 (1 skipped), technicalDocumentUpload.db 3,
  documentCleanup.db 4 (1 skipped), dataIntegrityDI.db 14, uploadBatches 5, importLimits 4, uploadPurposes 5: all passed.
- `npx next typegen`; `npx tsc --noEmit` exit 0; `npx eslint .` 0 errors (44 warnings, none in changed files);
  `python3 scripts/crosstab_selftest.py` all passed.
- Browser check: `node --check` only. Not run (lead runs browser gates).

Why the tests missed it: the 52R tests always passed the set id a reply had returned; none dropped the first reply.

## Limits

Files chosen while a selection's files wait join that selection when uploaded together (as in 52R). A selection whose
set was merged away and then retried starts a new set. The native 120 MB failure cause is still unknown; the next
replay will now record it.
