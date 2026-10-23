# Handover: B6-F01 and B6-F02 (main copy), 23 October 2026

Status: **implemented, ready for independent review.** Main copy. Follows
`docs/independent-batch6-review-main-2026-10-23.md` (frozen `9e190a4`), whose closures (B5-F01,
B5-F02, B5-F04) stand. **One migration: `0108_assistant_message_request_id.sql`** (additive,
nullable column and a partial unique index). Nothing pushed or deployed; no development or live
database touched; Grant applies the migration to his local database.

| Commit | What |
|---|---|
| `98230f8` | B6-F01, B6-F02, migration 0108, knowledge base and `claude/research-assistant.md` |
| this commit | Handover and status line |

## B6-F01: only the final response is the answer

`assistantLoop.ts`: the reply is the text of the response that ends the turn. Text written beside
tool calls in earlier rounds is not kept as the answer, so an empty final response gives "No
answer came back. Ask again." even after a text-bearing tool round; tables already built stay
listed under it. Running out of rounds gives only the stop message. The truncation refusal
(B5-F03, closed boundaries) is unchanged.

Tests (`researchAssistantTools.db.test.ts`): Codex's two-round repro (text and a calculator call,
then an empty `end_turn`) gives the empty reply; the same with a table keeps the table line; a
healthy two-round turn returns the final text, not the step before it. The earlier cut-off tests
still pass.

## B6-F02: one logical question is answered and stored once

- Migration 0108: `assistant_messages.request_id uuid` and a unique index on
  (run_id, request_id, role) where request_id is not null. Older rows have none.
- `askResearchAssistant(tenant, run, text, page, requestId)`: an id already answered returns the
  stored reply with `alreadyAnswered: true`, without a model call or a store (a report revision is
  not made again). Otherwise the pair is inserted under the id with `on conflict do nothing`; a
  racing send of the same request that stored first makes this one return that stored reply. An
  invalid id is refused; a non-string id at the server action is refused.
- Drawer: each question gets an id (`crypto.randomUUID()`); Send again, or the same text sent
  unchanged, reuses the failed question's id. After any failed send in a project the history is
  read back with request ids; a failed question whose request has a stored answer is cleared and
  the answer shown. A rejected action (outcome unknown) is "No answer arrived ... Send again asks it
  once; an answer already saved is shown, not repeated"; a server error (nothing stored) is "Not
  answered". Outside a project nothing is stored; failures there are "Not answered".
- Card: the same id reuse; a lost connection refreshes the page data so a stored answer appears,
  and the message says so.
- The run page reads the conversation without the request id, so it opens without 0108. Sending
  in a project and the drawer's read say "This needs migration 0108 applied first (npx.cmd supabase
  migration up)" when it is missing.
- Comments in the drawer, card and `researchAssistant.ts`, and the brief, now state this
  guarantee (atomic pair; idempotent per request id; reconciliation by read-back).

Tests:
- Real database: an answered request sent again returns the stored answer, makes no model call
  and stores nothing (rows checked with their request id); a new id is answered normally; two
  racing sends of one request store one pair and both return its answer; an invalid id is
  refused; a failed call stores nothing and the retry stores the pair once (kept from batch6).
- Browser (`assistant-drawer.check.mjs`, third test; the route lets the action run on the server
  with `route.fetch()` and then drops the reply): lost while the project is open, the stored answer
  shows and no failure; lost after moving to another project, nothing in that project and the
  answer on return, no failure; a provider error (replay rule `status: 400`) is "Not answered" and
  Send again answers it once; the database holds each pair once. The second test (sends aborted
  before reaching the server, both orderings) now expects "No answer arrived" and still passes.
- The card's equivalent path is identified from source, not separately browser-run.

## Checks run (cloud workspace, disposable PostgreSQL 16 with all migrations to 0108, real Python engine, production build, model replayed)

| Gate | Tree | Result |
|---|---|---|
| Full library | the repair tree | 1,492 passed, 70 skipped (198 files passed, 1 skipped) |
| Full native browser suite | same | 90 passed, 0 failed, 1 skipped (the gated real-model test) |
| Golden-thread smoke; objective acceptance | same | passed; passed |
| `generalAssistant`, `researchAssistantTools.db`, `helpIndex`, `sampleSize`, `figureTraceability.db`, `latestVerdictReaders.db` | same | 42 passed, 3 skipped (no-database placeholders) |
| Browser: assistant-drawer (3), research-assistant-tools, knowledge page render | same | 5 of 5 |
| `npx tsc --noEmit`; lint on changed files | same | pass; no errors or warnings |

## Limits

- An unanswered question is kept while the app is open in the tab, not across a reload.
- A reply lost while the read-back also fails leaves "No answer arrived" with Send again; that
  retry is safe (same id).
- No live model; outside a project usage is in the server log only.
