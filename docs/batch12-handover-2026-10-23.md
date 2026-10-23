# Handover: RR-F01, RR-F03 (remaining cases), RR-F06, RR-F07, RR-F08 and RR-M01 (main copy), 23 October 2026

Status: **implemented, ready for independent review.** Main copy. Follows
`docs/independent-batch10-review-main-2026-10-23.md` and the release audit Parts 2 to 4
(`docs/independent-release-readiness-audit-main-2026-10-23.md`), whose RR-F02 and RR-F04 closures
stand. Reviewed together with batch11 (RR-F05, `docs/batch11-handover-2026-10-23.md`). No
migration. Nothing pushed or deployed.

| Commit | What | Kind |
|---|---|---|
| `91fed93` | batch11: Next 16.4.1, vendored SheetJS 0.20.3 | dependencies |
| `ce2be9e` | RR-F01, RR-F03, RR-F06, RR-F07, RR-F08, RR-M01 | correctness, persistence, security, test reliability |
| this commit | Handovers and status line | |

## RR-F01: a brief reading with a missing field is malformed

`modelToolResult.requiredTextOrNullField`: a field the tool's schema requires must be present, as a
string or null; absent is `malformed`. `briefIntake` reads both `business_problem` and
`research_objective` with it, so `{}` or a result missing either field is a failed fill (recorded,
retried, typed text kept, the source not consumed), while both fields present as null stays a
reading that found nothing.

## RR-F03: the remote parser's converted copy is tracked

`documentStorageCleanup.convertedCopyPath` is the one rule for the copy the remote parser writes
(`<storage path>.converted.json`). `parseStatsFile` accepts only that location in the parser's
reply, reads it and removes it in a `finally` (read failures included); a removal that fails or
throws is recorded as a pending cleanup on its project (`queueOrphanStorageCleanup`, shown with
Import's "Retry file cleanup"), logged without contents if even that fails. Document deletion and
project deletion (`projectStoragePaths`) remove each source's converted copy by its derived path;
a converted copy of a source another document still names is kept with it. Brief:
`claude/project-deletion.md`.

## RR-F06: a cut-off report generation leaves the saved report

`storyNarrative.generateStoryNarrative` takes the narrative only from a finished `record_narrative`
call (`finishedToolInput`) with every required text field a string and `pillars` and `caveats`
lists; anything else throws before any write, so the saved narrative stays and the action records
`story_narrative_error`. `latestNarrativeFailure` (an error newer than the saved narrative) is now
shown in the Insights report section even when a narrative exists, saying the report shown is the
previous one and how to try again (before, the error showed only when there was no narrative).

## RR-F07: CSV text stays text

`src/lib/csvField.ts` (brief `claude/csv-export.md`): RFC 4180 quoting plus a leading apostrophe on a
value starting with `=`, `+`, `-` or `@` (also after spaces), a tab or a carriage return. The history
export uses it; it is the app's only CSV.

## RR-F08: every assistant answer takes a capacity slot

`src/lib/assistantCapacity.ts` now holds the claim (`withRequestClaim`, unchanged behaviour, moved
from `researchAssistant.ts`, which re-exports its errors) and `withAnswerCapacity`. A project send
without a request id and the assistant outside a project (`askGeneralAssistant`, which had no bound
either) take a slot under a key of their own before anything runs: they wait, or are refused as busy
with nothing run or stored. Keyed sends and same-id replay are unchanged.

## RR-M01: the chart fault test isolates its fault

`e2e/ui/analytics-posted-unknown.check.mjs` waits, after posting, until the project page's refresh
has finished (network idle and the launcher shown) before revoking SELECT on findings, and asserts
that the project error boundary is not shown while the card reports its posted state unknown. The
posted-state refusal and recovery assertions are unchanged.

## Tests

- `releaseAuditRepairs.db.test.ts` (real database; model client, storage and the parser's HTTP reply
  controlled), 23 cases: RR-F01 adds an empty result, a missing business problem and a missing
  objective as failed fills that consume nothing; RR-F03 expected deletion lists include converted
  copies, a shared file's copy is kept, and a new case: the parser's converted copy is removed after
  reading, a failed removal is recorded, a reply naming another object is refused with nothing
  removed, and deleting the project removes the copy.
- `narrativeWrongGroup.db.test.ts` (real database, actual generator), new case: cut-off, refused,
  missing summary and non-list pillars each leave the saved summary and are shown; a finished
  generation replaces it and clears the failure.
- `historyCsvFormula.db.test.ts` (new): the field rule's cases; the actual route's bytes opened by
  headless LibreOffice: formula-leading findings are text cells with no formula, and quoted text
  keeps its columns. Fails with the neutralising removed (checked).
- `researchAssistantTools.db.test.ts`, new case: ten unkeyed sends held, no more than the claim pool's
  size reach the model; a further unkeyed send and a general-assistant send are refused as busy with
  no model call; all finish after release; a keyed send still answers. Fails with the unkeyed branch
  restored to run without a slot (checked).
- `generalAssistant.test.ts` (no database): the capacity slot is replaced by a pass-through, since it
  needs the claim pool; it is tested above.

## Checks run

Cloud workspace, disposable PostgreSQL 16 with all migrations to 0110, real Python engine,
production build, model replayed. Tree: the content of `ce2be9e` (batch11 and batch12).

| Gate | Result |
|---|---|
| Full library | 1,545 passed, 72 skipped (206 files, 1 skipped) |
| Full native browser suite | 92 passed, 0 failed, 1 skipped (the gated real-model test) |
| Golden-thread smoke; objective acceptance | passed; passed |
| `releaseAuditRepairs.db`; `narrativeWrongGroup.db`; `historyCsvFormula.db`; `researchAssistantTools.db` | 23 passed; 5 passed, 1 placeholder skipped; 2 passed; 22 passed, 1 placeholder skipped |
| `npx tsc --noEmit`; lint on changed files; production build | pass; no errors (warnings only the unused imports already in `runs/[id]/page.tsx`); pass |

An earlier full run on this batch had 7 library failures in `narrativeFigureTrace.test.ts`, whose
scripted model reply gave its tool call no name (the real API always names it; the completion check
requires the forced tool's name), and one browser failure: the project-deletion check expected one
listed file where there are now two (the data file and its converted copy). Both checks were
corrected, the notice's wording for more than one file was fixed ("are still in storage"), and the
final run above is clean.

## Limits

- RR-F05's remaining audit entries (development tooling, `pptxgenjs` through `image-size`) are listed
  in batch11, not addressed.
- Per-tenant model budgets remain a product decision (audit Part 3); capacity is a concurrency bound,
  not a spend limit.
- Other model-call sites in the audit's register are not covered here.
