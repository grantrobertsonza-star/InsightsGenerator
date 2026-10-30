# Handover: B5-F01 to B5-F05 (main copy), 22 October 2026

Status: **implemented, ready for independent review.** Main copy. Follows
`docs/independent-batch5-review-main-2026-10-22.md` (frozen `de3c346`), whose closures (B4-F01,
B3-01, M-B4-01) stand. No migration; nothing pushed or deployed; no development or live database
touched.

| Commit | What |
|---|---|
| `af9fed4` | B5-F01 to B5-F05 (below), knowledge base guide and `claude/research-assistant.md` |
| this commit | Handover and status line |

## B5-F01: one sample size model in both directions

`sampleSize.ts`: the design effect now sits inside the variance before the finite population
correction, so the forward calculation is the reverse formula solved for n:
n0 = z² · deff · p(1−p) / e², n = n0 · N / (N + n0 − 1), rounded up. That is the smallest whole n
whose margin is at most e and is never more than N. Codex's cases: e 5, N 1,000, deff 2 gives
**435** (was 556); N 100 gives **89** (was 160, more than the population). `marginForSample` and
the new `marginFraction` (unrounded) share one computation. A response rate that would need more
people than the population is refused with the reason; a feasible one returns the number.

Tests (`sampleSize.test.ts`, 8): the two combined references; an independent oracle in the test
(its own margin formula, enumerating whole samples) agrees with the calculator on all 576
combinations of confidence 90/95/99, margin 2/3/5/8, deff 1/1.5/2/3, N none/50/100/1,000/5,000/
100,000 and share 50/20; the response-rate refusal and a feasible recovery (870 at 50%); the
earlier references unchanged (385, 1,068, 278, 577, 664, 246; margins 3.1, 4.9, 3.8).

## B5-F02: calculator options checked before defaults

`researchAssistantTools.ts` `sampleSizeOptions`: `mode` must be `sample_for_margin` or
`margin_for_sample`; every option given must be a finite number, otherwise an error result names
it ("confidence_pct must be a number, not \"99\"..."); only an absent or null option takes its
default; the mode's required value must be present. Ranges stay in `sampleSize.ts`.

Tests (`generalAssistant.test.ts`): text "99", text "2", text "5", NaN, an unknown mode, a missing
mode and a missing sample size are all error results; null takes the default (385); numbers are
used as given (664 at 99%; 435 combined).

## B5-F03: unfinished replies are not published

`assistantLoop.ts`: a response whose `stop_reason` is not `end_turn`, `tool_use` or
`stop_sequence` ends the loop; its text is dropped and none of its tool calls runs (including a
terminal `revise_narrative`). `max_tokens` gives "My answer was cut off before it finished, so it
is not shown. Ask again, or ask something narrower."; another stop names itself; an empty finished
answer gives "No answer came back. Ask again." Tables from earlier rounds stay listed. Both
assistants use the loop.

Tests: project assistant (real database): a cut-off text with a `revise_narrative` call publishes
the cut-off reply, revises nothing and makes one model call; a cut-off `build_table` builds
nothing; a healthy reply follows. General assistant: cut-off text, cut-off tool call, a `refusal`
stop, an empty answer, and a healthy answer.

## B5-F04: a saved table whose read-back fails is still counted and listed

`researchAssistantTools.ts`: after `buildCrosstab` returns, a thrown or empty `loadCrosstab`
returns an error result that still carries the table (`readBack: false`). It counts towards the
four-table cap, the model is told the draft exists and not to build it again, and the reply's
table line marks it "(saved, but its figures could not be read back)".

Test (real database, build and read-back mocked): six requested builds with failing read-back
make four builds; the fifth and sixth hit the cap; the reply lists four tables with the mark; a
healthy build afterwards is listed without it.

## B5-F05: a failed question stays with its conversation

- Persistence (`researchAssistant.ts`): the question and its reply are inserted together in one
  transaction once the reply exists, checked against run and tenant in the same statement. A
  failed call stores nothing, so asking again stores the pair once. Earlier the question was
  stored before the model call and a failure left it unanswered.
- Drawer (`AssistantDrawer.tsx`): each conversation keeps its own draft, waiting flag and failed
  question. A failed or dropped send, whenever it arrives, is recorded on the conversation it was
  sent from: the question leaves the list, a box shows "Not answered: ...", the reason, Send again
  and Dismiss, only in that conversation, and the question goes back in that conversation's box.
  Reading the saved history back keeps the failure. Lasts while the app is open in the tab.
- Card (`ResearchAssistantCard.tsx`): a failed send, including a dropped connection, takes the
  question out of the list and puts it back in the box, with an error naming it.

Tests: real database: a failed call stores nothing, the retry stores exactly the pair. Browser
(`assistant-drawer.check.mjs`, second test, two projects switched with the project selector): a
failure arriving while A is open shows only in A, the question is kept in A's box and B's is empty;
a failure arriving after moving to B is not shown in B and is there on return to A; Send again
answers both; the database holds each question once with its reply, and nothing for B. The
first test (guide answer, focus, Try again, saved conversation) still passes. The successful late
reply stays scoped (Codex's positive control; the reply is appended to its own conversation and
read back on return).

## Checks run (cloud workspace, disposable PostgreSQL 16, real Python engine, production build, model replayed)

| Gate | Tree | Result |
|---|---|---|
| Full library | the repair tree (`af9fed4` content) | 1,489 passed, 70 skipped (198 files passed, 1 skipped) |
| Full native browser suite | same | 89 passed, 0 failed, 1 skipped (the gated real-model test) |
| Golden-thread smoke; objective acceptance | same | passed; passed |
| `sampleSize`, `generalAssistant`, `researchAssistantTools.db`, `figureTraceability.db`, `latestVerdictReaders.db` | same | 8, 6, 11 (+1 placeholder skipped), 11 (+2 skipped) passed |
| Browser: assistant-drawer (2), research-assistant-tools, knowledge page render | same | 4 of 4 |
| `npx tsc --noEmit`; lint on changed files | same | pass; no errors or warnings |

Mocks: the model everywhere; dictionary, build, read-back and set-up reads in the assistant
tools test. Real: PostgreSQL, the Python engine in the browser checks, the help index, the
calculator and its oracle.

## Limits

- The drawer's per-conversation state lasts while the app is open in the tab; a reload loses an
  unanswered question (nothing was stored for it).
- No live model: tool choices, wording and the caching saving remain unmeasured.
- Outside a project, usage is in the server log only.
- The objective identity failure from batch5's run remains unexplained (Codex: 10 of 10 re-runs);
  its trace was not kept.
