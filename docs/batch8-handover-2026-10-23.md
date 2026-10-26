# Handover: B7-F01 and four open items (main copy), 23 October 2026

Status: **implemented, ready for independent review.** Main copy. Follows
`docs/independent-batch7-review-main-2026-10-23.md` (frozen `6a7319d`), whose closures (B6-F01;
the original B6-F02 lost-after-save case; migration 0108 at its disposable boundaries) stand.
**One migration: `0109_tenant_api_usage.sql`** (a new table; additive). Nothing pushed or deployed;
no development or live database touched. Grant applied 0108 by hand on 2026-10-23.

| Commit | What | Kind |
|---|---|---|
| `cbe4b29` | Stats cache sweep; plain connection wording; read-only migration history check; usage outside projects (0109) | reliability, privacy, tooling, cost |
| `658ca5b` | B7-F01: the request is claimed before the model or tools run; a revision is applied only with its stored answer; a retried question reuses its tables; the assistant opens as a compact window (380 by up to 560 px) | correctness, design |
| this commit | Handover and status line | |

## B7-F01: one execution per request

`askResearchAssistant` with a request id now runs inside `withRequestClaim`
(`researchAssistant.ts`): a Postgres session advisory lock keyed on run and request, taken on a
pooled connection before the model or any tool runs, outside any transaction. A second send of the
same request tries again every 250 ms, borrowing a connection only per try; once it holds the
claim it re-reads the stored answer and returns it without a model call. Waiting is bounded
(`requestClaimWaitMs()`, 5 minutes or `ASSISTANT_REQUEST_WAIT_MS`); past it the send fails with
`RequestInProgressError`, having run and stored nothing, and the action returns `stillRunning:
true` ("Still being answered" in the drawer and card). The claim is released in `finally`; a failed
unlock destroys that connection; Postgres releases it if the connection or process dies.

Guarantee (also in the code and `claude/research-assistant.md`): within one database, two sends of
one request never run the model or tools at the same time, and a later send sees the earlier one's
stored answer.

A send that fails part way no longer has its work repeated by the retry (Grant, 2026-10-23:
"shouldn't this be fixed?"):

- A report revision is applied in the same transaction that stores the question and its reply. A
  failed store rolls it back, so a revision exists only with its stored answer and is applied once.
- A table built for a question is tagged with the request id and a key of the exact table request;
  the retry of that question reuses it instead of building it again. Different tables, and other
  questions, are built as before. A failed send can therefore leave only draft tables, which its
  retry reuses.

Tests (`researchAssistantTools.db.test.ts`, real database; model, dictionary, build mocked; the
build call is the side-effect counter, and the build mock saves a draft row with its request tag):
a send that builds and then fails leaves one draft that the retry reuses (no second build), a
different table is still built and another question builds its own; a revision whose answer cannot
be stored leaves the report unchanged, the retry applies it once and a replay does not revise
again; overlapping sends with the first held at a gate make two
model calls (one execution) and **one** build, the second returns the stored answer, and a later
replay makes no model call and no build; a held first send that then fails lets the waiting send
run once (one build, one stored pair), while an unrelated request is answered during the hold; a
wait past a 500 ms limit is `RequestInProgressError` with no model call, and the first still
answers.

## Open items done while waiting for review

1. **Stats cache sweep** (`parseStatsFile.ts`). Each data file read kept its download
   (`stats-src-<hash>`) in the temporary folder for good: respondent-level data on disk with no
   end. `sweepStatsCache` now removes downloads and `.part` files older than 30 minutes (longer
   than the 10-minute reuse window plus the worker's 5-minute limit), at most once a minute per
   process, best effort. Test `statsCacheSweep.test.ts` (real temporary folder): old files and
   `.part` files removed, recent and just-inside-window kept, other files and folders untouched,
   an unreadable folder is not an error.
2. **Plain connection wording** (`components/connectionError.ts`). The browser's own messages for
   a request with no answer ("Failed to fetch", "Load failed", Firefox's NetworkError) are shown
   as "The connection to the server was lost before an answer came back." in the drawer (load
   and send) and card; a dropped upload in the card says the file may have been uploaded and to
   check Import data. Server messages are unchanged. Tests: `connectionError.test.ts`; the drawer
   browser test asserts the plain wording on a failed load and no "Failed to fetch".
3. **Migration history check** (`scripts/migration-history-check.mjs`, brief
   `claude/migration-history.md`). Read only: for each migration the Supabase CLI has not recorded,
   it looks for the objects the file creates and reports all, some or none present, and prints
   (does not run) `supabase migration repair --status applied` for the complete ones. Test
   `migrationHistoryCheck.db.test.ts` (real disposable database with every migration, record
   listing 0001 to 0061, 0108 removed): 0062 present, 0108 not applied, repair line lists 0062 and
   not 0061 or 0108, record and schema unchanged.
4. **Usage outside projects** (migration 0109, `apiUsage.ts`, dashboard). The assistant's calls
   outside a project are recorded in `tenant_api_usage` (`logTenantApiUsage`; a failed write is
   logged with its figures) and shown on the dashboard Overview for the last 30 days
   (`loadTenantUsageOutsideProjects`: calls, input with the part from cache, estimated cost via
   `costOfUsage`; a failed read is shown as such; a missing table says it needs 0109). Tests
   `tenantUsage.db.test.ts` (real database: sums, cache tokens, cost reference $0.0033, older and
   other-tenant rows excluded, failed write logged, missing table message); `generalAssistant.test`
   checks the usage write; the drawer browser test checks the dashboard line.

## Checks run (cloud workspace, disposable PostgreSQL 16 with all migrations to 0109, real Python engine, production build, model replayed)

| Gate | Tree | Result |
|---|---|---|
| Full library | `658ca5b` content less the window size change | 1,504 passed, 72 skipped (202 files, 1 skipped) |
| Full native browser suite | same | 90 passed, 0 failed, 1 skipped |
| Golden-thread smoke; objective acceptance | same | passed; passed |
| Window size: assistant-drawer (3, with size checks at 1440 px and 390 px), research-assistant-tools, knowledge page, each run 3 times | final | 15 of 15 |
| `helpIndex`, `researchAssistantTools.db`, `generalAssistant` | final | 28 passed, 1 skipped |
| Full library | items tree (before B7-F01) | 1,499 passed, 72 skipped |
| `researchAssistantTools.db` | final | 19 passed, 1 placeholder skipped |
| Items: `statsCacheSweep`, `connectionError`, `tenantUsage.db`, `migrationHistoryCheck.db`, `generalAssistant`, `helpIndex` | items tree | all passed |
| Browser: assistant-drawer (3), research-assistant-tools, knowledge page render | items tree | 5 of 5 |
| `npx tsc --noEmit`; lint on changed files | final | pass; no errors or warnings |

## Compact window

The assistant opens as a window in the bottom-right corner, 380 px wide and at most 560 px tall
(Grant, 2026-10-23: "make the window smaller so we can still see the window we are in"), not a
full-height panel; on a phone it spans the width less a 16 px gutter with no sideways scroll. The
drawer test checks both sizes. The test now also waits for the conversation to finish loading
before typing: Send is not taken while it loads (the question stays in the box), which made one
run of the second drawer test fail before the wait was added.

## For Grant

- Apply 0109 the way 0108 was applied (Studio SQL editor), or repair the migration history first
  (`claude/migration-history.md`) and then use `npx.cmd supabase migration up`.

## Limits

- The request claim covers one database. A failed send can leave draft tables; its retry reuses
  them, but if the question is never asked again they stay as drafts until deleted.
- No live model; the caching saving and live tool choices remain unmeasured.
