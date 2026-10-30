# Handover: release audit RR-F01, RR-F02, RR-F03 and RR-F04 (main copy), 23 October 2026

Status: **implemented, ready for independent review.** Main copy. Follows
`docs/independent-release-readiness-audit-main-2026-10-23.md` (Part 1, frozen `524d726`) and
`docs/independent-batch9-review-main-2026-10-23.md`, whose closures stand. **Migration 0110 is new**
(additive). RR-F05 (dependencies) is not in this batch: it waits for Grant's decision. Nothing
pushed or deployed; no development or live database touched.

| Commit | What | Kind |
|---|---|---|
| `1f19dfa` | RR-F01, RR-F02, RR-F03 (with 0110), RR-F04 | correctness, persistence |
| this commit | Handover and status line | |

## RR-F01: a brief fill uses only a finished model call

New `src/lib/modelToolResult.ts` (`finishedToolInput`, `optionalTextField`,
`UnfinishedModelResultError`; brief `claude/model-call-completion.md`). `briefIntake.ts` now takes
the tool input only from a response that stopped with `tool_use` and carries `record_brief_fields`
as an object; a cut-off, refused, other-stop, missing or wrong-shaped result throws, and a field
that is neither a string nor null is malformed. The existing failure path in `saveRunContext`
then applies unchanged: `brief_intake_error` recorded, a failed fill returned with its retry, what
was typed saved, no objective added, no `brief_intake_used`, so the next ordinary fill reads the
same document again. A finished call with both fields null is still a fill that found nothing.

## RR-F02: a methodology reading replaces the saved text only when it finished

`methodologyExtractor.ts` uses the same helper; `found` must be a boolean, and `found: true` with
no text is malformed. Every failure throws before anything is written, so the saved methodology
stays. A finished reading records `methodology_extraction_done` (with or without a methodology;
`found: false` keeps the saved text, as before). `methodologyStatus.latestMethodologyFailure` (the later of the done
and error events, and whether a methodology is saved) is shown in the Insights report section
(`data-testid="methodology-failure"`, with "Use Regenerate report content to try again"), and the
Word report export passes `methodologyUnread` when the latest reading failed and none was saved:
the Methodology section then says it could not be read, not that none was stated.

## RR-F03: project deletion keeps its storage cleanup until storage confirms it

Migration `0110_project_storage_cleanup.sql`: `project_storage_cleanup` (tenant-scoped, RLS, no
foreign key to `runs`). `runActions.deleteRun` (brief `claude/project-deletion.md`): one
transaction refuses without 0110 or for a project not this organisation's, locks the project row
(as uploads do between storing and recording a file), lists every source and preview path and the
paths of pending single-document cleanups, records them, and deletes the project. Then
`finishProjectStorageCleanup` removes the files under a row lock (`skip locked`): a path another
document still names is left, a path outside `<tenant>/` is kept on the record with an error, a
storage error or thrown call is recorded (`attempts`, `last_error`), and the record goes only
after storage reports no error. The dashboard shows deleted projects whose files are still stored,
with the error and "Remove them now" (`retryProjectStorageCleanup`), or that the list could not be
read; the Delete button shows a refusal beside it. The preview path is now removed too.

## RR-F04: one minimum sample in both directions

`sampleSize.ts`: `MIN_SAMPLE = 2`. A forward result below two is raised to two with a step saying
so (two still meets the margin, since more interviews only narrow it); the margin direction keeps
refusing fewer than two. Knowledge base (Research assistant, sample sizes) and
`claude/research-assistant.md` say so; the help index is regenerated.

## Tests

- `src/lib/__tests__/releaseAuditRepairs.db.test.ts` (new, real database; model client and
  storage controlled), 19 cases: RR-F01 cut-off then ordinary retry; refusal, no tool result,
  another tool, malformed field, non-object input; finished empty fill not a failure. RR-F02
  cut-off keeps the text and the failure shows until a finished reading; refusal, no tool,
  found-without-text, malformed `found`; `found: false` keeps and clears; Word text for an unread
  methodology. RR-F03 success removes source, preview and a pending single-document path; storage
  error, then thrown call, then success; foreign and unknown project refused; still-named path
  kept, outside path recorded; refusal without 0110. The RR-F01 and RR-F02 cases, and the RR-F04
  cases below, were run against the files before the repair and failed (14 of 30).
- `src/lib/__tests__/sampleSize.test.ts`: RR-F04 reference case (95%, 1%, 49 points gives 2 and is
  accepted back), a grid of 384 small-share, wide-margin combinations against the enumeration
  oracle, and the reverse refusal of one.
- `e2e/ui/project-delete-storage.check.mjs` (new, browser): with the storage stand-in refusing
  removals, the project disappears, the dashboard lists its file with the error, the file stays
  stored and the record survives a reload; with storage healthy, "Remove them now" removes the
  file, the notice and the record.

## Checks run

Cloud workspace, disposable PostgreSQL 16 with all migrations to 0110, real Python engine,
production build, model replayed. Tree: the content of `1f19dfa`.

| Gate | Result |
|---|---|
| Full library (`src/lib/__tests__`) | 1,534 passed, 72 skipped (204 files, 1 skipped) |
| Full native browser suite | 92 passed, 0 failed, 1 skipped (the gated real-model test) |
| Golden-thread smoke; objective acceptance | passed; passed |
| `releaseAuditRepairs.db`; `sampleSize` | 19 passed; 11 passed |
| The same RR-F01, RR-F02 and RR-F04 cases against the files before the repair | 14 of 30 failed, as expected |
| `npx tsc --noEmit`; lint on changed files | pass; no errors, 7 warnings, all unused imports already in `runs/[id]/page.tsx` |

An earlier full run (before two corrections in this tree) had two browser failures: the new
deletion check located the project card by text that the new notice also contains (the check now
targets the card's Delete button; the application behaved as intended in that run), and
`objective-setup-review-identity` failed once, as it did once before and Codex could not
reproduce; it passed in the final run. That run's 7 library failures were export tests that could
not load the new methodology status module through the `@/` alias; the module was separated and
the tests list it, as they do the export's other modules.

## Migration

0110 is additive. Grant applies it by hand in the Studio SQL editor (not `migration up`). Until it
is applied, deleting a project is refused with a message naming it, and nothing is deleted;
everything else is unaffected.

## Limits

- RR-F05 is open (Next 16.3.6 Server Actions advisory; xlsx 0.18.5 on uploaded coding files).
- No retention deadline for a deleted project's files: removal happens at deletion and on retry.
- Objects in a project's folder that no row names are not looked for (none are known to exist).
- The other model-call sites, and the rest of the audit (Parts 2 to 4), are not covered here.
