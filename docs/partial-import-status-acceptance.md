# IMP-006 / REP-IN-001 — truthful partial-report import status (preparation document)

Status: **preparation only, while Codex verifies P2a.** No production file was modified to produce this document. `extractFindings.ts`, `findingArchive.ts`, `page.tsx` and the rest of P2a's frozen boundary are unchanged; everything below is read-only source inspection plus one new, isolated test file (`src/lib/__tests__/reportImportCompletion.test.ts`) that imports and calls the real `extractFindingsFromDocument` with every external dependency mocked. **Do not implement the proposed change in §3 until P2a releases these files.**

## 1. Confirmed defect, reproduced

`extractFindingsFromDocument` (`src/lib/extractFindings.ts:780`) splits a report into chunks (`buildChunks`, `CHUNK_CHARS = 25000`) and reads each chunk independently via `mapWithConcurrency`. Each chunk's own failure is caught, recorded only in a `trace` row (`extract_findings_chunk_error`), and otherwise swallowed — `chunkErrors` only matters to the function's own control flow:

```ts
if (allRows.length === 0 && chunkErrors.length > 0) {
  // throws
}
return allRows;
```

So whenever **at least one chunk succeeds**, the function returns normally — `allRows`, a bare `{ id, finding_text }[]` — with nothing in that return value, or in its type, that says some chunks failed. The only record of a partial failure is the `extract_findings_summary` trace event's `failedParts` field, which no caller reads.

By source inspection (not executed — see the evidence-label correction in §4), both of page.tsx's call sites appear to treat this non-throwing return as complete success:

- **`extractFindingsAction`** (`page.tsx:1982`): `await extractFindingsFromDocument(...); await setDocumentProcessingStatus(documentId, "ready");` — unconditional "ready" on any non-throw.
- **The batch/reprocess loop** (`page.tsx:~2669`): `if (doc.kind !== "transcript") await setDocumentProcessingStatus(doc.id, "ready");` — the transcript branch is the ONE kind that already has its own partial-completion concept (`"incomplete"`, from ANA-QUAL-001) and is explicitly excluded from this blanket line; `"report"` documents have no such carve-out, because `extractFindingsFromDocument` gives the caller nothing to carve out on.

**The chunk-level part of this is executed and reproduced** in `reportImportCompletion.test.ts`'s case 2 test (now explicitly labeled a **characterization test**, not an acceptance test — see §4): a synthetic 2-chunk document where chunk 1 succeeds and chunk 2 fails resolves successfully with 1 finding and a trace row showing `failedParts: 1, findings: 1`. **What this proves and does not prove:** it proves `extractFindingsFromDocument` itself returns no partial-failure signal. It does **not** exercise `page.tsx` at all, so it does not prove what status either caller actually persists — that remains source-inspection only, stated as such.

## 2. Acceptance criteria (frozen for this repair package)

1. **All chunks succeed → complete.** `processing_status` is set to `"ready"`.
2. **Some chunks fail → visibly incomplete, including after reload.** `processing_status` must be set to `"incomplete"` (the column/constraint already exists — `markDocumentProcessingStatus`'s own type signature already allows it, added for ANA-QUAL-001), and this must be the value a researcher sees on reload, not just an in-memory signal from the one request that happened to run the extraction.
3. **All chunks fail → failed.** `processing_status` is set to `"failed"`, and the thrown error names the document and part count.
4. **Status persistence fails → actionable failure, never apparent completion.** If the `processing_status` write itself fails (e.g. a pre-migration database missing the column/constraint), the researcher must see an actionable failure — not a page that looks like "ready" because the write's own failure was swallowed.
5. **Retry preserves retained human work and does not silently duplicate it.** Retrying a partially- or fully-failed extraction must not discard findings a researcher has already reviewed and accepted, and must not insert a second copy of a finding that already exists from an earlier, partially-successful attempt. This criterion is governed by REP-IN-002's existing replacement-recovery requirement (§3) — it is not a separate contract and this package does not independently choose a retry strategy for it.

**Evidence-label correction (this revision):** criteria 1 and 3 above are NOT marked "already correct today" anywhere in this document, because no executed test in this package exercises `page.tsx`'s persistence of `"ready"` or `"failed"`. An extraction function returning successfully, or throwing, does not by itself establish that a caller persisted a particular status — that is a separate write this package has not run. Criteria 1 and 3's chunk-level mechanics (does the function return/throw in each case) are executed and passing (§4); whether the caller then persists the matching status is source-inspection only, same as criteria 4 and 5.

## 3. Minimum proposed production change (not implemented — documented only)

This section is the proposal `extractFindingsFromDocument`'s callers would need once P2a releases these files. It is **not implemented**; implementing it is explicitly out of scope for this preparation step, and must wait for that boundary regardless of how small the change looks.

- **Change `extractFindingsFromDocument`'s return type** from `{ id: string; finding_text: string }[]` to something that carries completion state, e.g. `{ rows: { id: string; finding_text: string }[]; failedParts: number; totalParts: number }`. This is the one change that closes the root cause: today's return value has no field a caller could check even if it wanted to.
- **Update both call sites in `page.tsx`** to read that new field and call `setDocumentProcessingStatus(documentId, result.failedParts > 0 ? "incomplete" : "ready")` instead of an unconditional `"ready"` — mirroring the pattern the transcript path (`extractThemesFromTranscript`'s own `"ready"`/`"incomplete"` return) already establishes for a different document kind.
- **Make `setDocumentProcessingStatus` (`page.tsx:417`) return the boolean `markDocumentProcessingStatus` already produces**, and have both call sites push an actionable message onto `errors`/`recordSingleDocumentError` when that boolean is `false` — the same pattern the batch loop already uses for the transcript kind's own `result.statusPersisted` check (`page.tsx:~2645`), generalised to every kind rather than only transcripts. This closes acceptance criterion 4.
- **Criterion 5 (retry/duplication) is governed by REP-IN-002, not a new or independent choice.** REP-IN-002 (`claude/backlog-downstream-workflow-review-2026-10-14.md`, Batch 2) already states the binding requirement for this exact situation: *"Stage extraction replacements before publishing them (never archive the old before the new is confirmed good). Failed rereading must preserve the previous usable live version."* `archiveAndReplaceFindings` (`findingArchive.ts`) currently archives/deletes existing findings for a document **before** the replacement chunks have resolved (REP-IN-002's own confirmed finding, at `extractFindings.ts:859` per that review), which is precisely what would let a partial-failure retry discard previously accepted, human-reviewed findings before the retry's own success is known. **This package does not propose "default to reject-only retry," or any other independent retry-scoping decision, as a substitute for REP-IN-002's staging requirement.** The correct closure of criterion 5 is for the retry path this repair touches to honor REP-IN-002's staging contract once REP-IN-002 itself is implemented (stage the new chunks' results, confirm they are good, and only then replace/archive the old ones) — not to invent a parallel, narrower rule scoped only to IMP-006. If REP-IN-002 and this repair are sequenced separately, criterion 5 should be held open, not marked closed by a workaround.

### Smallest implementation covering all five criteria together (proposal, not implemented)

In dependency order, once P2a's files are released:

1. `extractFindingsFromDocument` returns `{ rows, failedParts, totalParts }` instead of a bare array (closes the information gap criteria 1-3 depend on).
2. Both `page.tsx` call sites derive `"ready"` vs `"incomplete"` vs `"failed"` from that return (and from the existing thrown-error path for criterion 3), instead of the current unconditional `"ready"` (closes criteria 1-3 at the caller).
3. `setDocumentProcessingStatus` propagates `markDocumentProcessingStatus`'s existing boolean instead of discarding it, and both call sites surface a failure through the same `errors`/trace path already used for the transcript kind (closes criterion 4).
4. Criterion 5 is **not** closed by a change local to this repair. It is closed when REP-IN-002's staging requirement is implemented in `archiveAndReplaceFindings`/`extractFindingsFromDocument`'s call to it, and this repair's retry path is verified against that staged behavior rather than today's archive-before-confirm behavior. If REP-IN-002 is not yet implemented when this repair ships, criterion 5 stays explicitly open rather than being marked closed.

Steps 1-3 are the smallest change that closes criteria 1, 2, 3 and 4 without touching `findingArchive.ts` at all. Step 4 is out of this repair's own hands until REP-IN-002 is addressed.

## 4. Test evidence

`npx vitest run src/lib/__tests__/reportImportCompletion.test.ts` — **4 passed, 2 skipped**, through the real `extractFindingsFromDocument`, with `../db`, `../supabaseAdmin`, `../anthropic`, `../findingArchive`, `../tableComputation` and `../apiUsage` mocked as the external boundaries:

| Case | Status | What it proves | What it does NOT prove |
|---|---|---|---|
| 1 — all chunks succeed | **Executable, passing** | `extractFindingsFromDocument` returns every chunk's findings; trace shows `failedParts: 0`. | That `page.tsx` persists `"ready"` — not exercised. |
| 2 — some chunks fail | **CHARACTERIZATION TEST, passing** (pins today's defective behavior; not an acceptance test) | `extractFindingsFromDocument` returns successfully with partial findings; nothing in the return value signals the partial failure. | That `page.tsx` persists anything in particular on this input — not exercised. When implementation starts, this test should be kept as a "before" record and a **separate new test** added asserting the corrected structured return and, through the actual `page.tsx` caller, a durable `"incomplete"` status after reload. |
| 3 — all chunks fail | **Executable, passing** | `extractFindingsFromDocument` throws, with the multi-part wrapper message. | That `page.tsx` persists `"failed"` on that throw — not exercised. An extraction function throwing does not by itself establish what its caller does with that throw. |
| baseline — single-chunk failure | **Executable, passing** | A one-chunk document's failure still throws with its own message, unaffected by the multi-chunk branch. | Same caller-persistence caveat as case 3. |
| 4 — status persistence failure | **Not executed. Unclosed acceptance case.** | — | Source inspection (§1) identifies where the gap likely is (`setDocumentProcessingStatus` discarding `markDocumentProcessingStatus`'s boolean), but this is a read of the code, not a run of it — it does not close the criterion. |
| 5 — retry preserves human work | **Not executed. Unclosed acceptance case.** | — | Same caveat as case 4; additionally gated on REP-IN-002 per §3 above, not resolvable by this package alone. |

`npx tsc --noEmit -p .` is clean.

## 5. What was and was not touched

**Created, nothing else:**
- `docs/partial-import-status-acceptance.md` (this file)
- `src/lib/__tests__/reportImportCompletion.test.ts`

**Not touched:** `extractFindings.ts`, `findingArchive.ts`, `page.tsx`, any other production file, any existing test file, any dependency, configuration, schema or migration. DEC-001 and OBJ-REV-009's closures are untouched — nothing in this preparation step reads or writes decision candidates, objectives, or their review state.

## 6. Pause point

This preparation package (acceptance criteria, reproduction, proposed-but-not-implemented production change, and test evidence, with corrected evidence labels) is complete for IMP-006 / REP-IN-001. No implementation was started. Pausing here, per instruction, while Codex verifies P2a.
