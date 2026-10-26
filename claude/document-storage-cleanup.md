# Document upload and deletion storage cleanup

The IMP-007 deletion path records a `document_storage_cleanup_pending` trace row in the same
transaction that locks and deletes the owned document and its findings. If recording intent fails,
the transaction rolls back and the source file remains untouched. Storage removal follows commit.

The pending row contains the document identity and exact source/preview paths. It remains until
storage removal and the completion write both succeed. Import shows the pending count and a retry
control. A failed retry keeps the notice and displays its error. Repeated successful cleanup is safe.

Retries read jobs by tenant and run, require the tenant/run path prefix and refuse any path still
referenced by a document. The cleanup intent is an operational record, not a replacement for human
review or provenance history. No storage configuration or deployment-role change is implied.

Verification: `documentCleanup.db.test.ts` injects combined storage/trace failure, then exercises
durable pending state, failed retry, wrong-run isolation and successful/idempotent recovery on real
disposable PostgreSQL. Storage is the controlled boundary.

Uploads also commit intent before writing storage. The upload holds the owned run row lock through
the external write and document insert, and removes intent in that insert transaction. Cleanup takes
the same lock and checks the intent still exists. If cleanup wins before upload starts, upload refuses
before writing bytes; it cannot recreate an untracked object. If document insertion fails, rollback
retains the earlier intent. Storage or completion-write failures leave that record for the visible retry.
Unique object names prevent concurrent retries from targeting each other's bytes. No performance
improvement is claimed; this deliberately serializes storage changes within one project for safety.

The upload fault case exercises insertion failure, storage failure, later trace-write failure,
idempotent cleanup and corrected upload. Native storage-fault injection remains a separate check.
