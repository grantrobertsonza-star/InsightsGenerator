# Research assistant: data tools, sample size calculator and method advice

Grant, 2026-10-22: "the research assistant should be our expert. Not only on the imported study,
its data, findings, insights etc, but also give general advice, like ... what should a minimum
sample size be if I want to generalise my finding nationally, or if I want a 5% MOE". Tables the
assistant builds are "saved as drafts" (Grant's choice).

## Floating drawer (every page)

Grant, 2026-10-22: "a floating Research assistant on every page that the user can click on and ask
questions ... It must have access to our knowledge base". Grant's choices: every page; the same
conversation as the Research assistant section inside a project; a side drawer.

- `src/components/AssistantDrawer.tsx`, mounted in `GlobalShell`. Button bottom-right
  (`assistant-fab`), a compact window in that corner, 380 px wide and up to 560 px tall, full width less a 16 px gutter on a phone (`assistant-drawer`, role dialog, not modal; made smaller 2026-10-23 so the page stays in view). Esc or
  close; focus goes to the input on open and back to the button on close. Hidden on /login,
  /no-organisation, and on the Research assistant section (`openSection.id === "assistant"`).
- Inside a project (`/runs/<uuid>`): `loadAssistantMessages(runId)` on each open (tenant and run
  scoped, `loadAssistantConversation` in researchAssistant.ts, also used by page.tsx), then
  `sendAssistantMessage(runId, text, page)`; after a reply the conversation is read back so the
  saved copy shows. The Research assistant card takes a newer saved history from the page refresh
  (prop sync, skipped while its own send is pending).
- Outside a project: `sendGeneralAssistantMessage(text, history, page)` -> `askGeneralAssistant`
  (generalAssistant.ts): help tools and the calculator only; the chat lives in the drawer's state
  for the browser session and is not stored. History is checked at the server boundary
  (`checkedHistory`: user/assistant roles, non-empty, 4,000 chars each, last 20) and sent as
  alternating turns.
- Page context: `{path, section}` from the drawer, checked by `checkedPageContext` (an in-app path
  only; the section name stripped to letters, digits and simple punctuation, 80 chars); the line
  goes in the uncached part of the system text. RunNav publishes the open section
  (`components/openSection.ts`).
- Request ordering: conversations are keyed (run id or "general"); a load older than the latest,
  or for a project the researcher has left, is ignored; a reply is added to the conversation it
  was sent from. A failed or dropped load shows "could not be loaded" with Try again, and Send is
  disabled.
- Per-conversation state (Codex B5-F05): each key keeps its own draft, waiting flag and failed
  question. A failed or dropped send, whenever it arrives, is recorded on the conversation it was
  sent from: the optimistic question leaves the list, the failure box ("Not answered: ...", the
  reason, Send again, Dismiss) shows only there, and the question goes back in that conversation's
  draft. Reading the saved history back replaces only the messages, so the failure stays. The
  state lasts while the app is open in the tab, not across a reload. The Research assistant card
  does the same on its own failures (question back in the box, error names it).

## Knowledge base and Manual as tools

- `scripts/build-help-index.mjs` renders every Knowledge base article and Manual page
  (esbuild + react-dom/server + linkedom) into `src/lib/helpIndex.generated.json`, split at each
  h2, navigation removed. `--check` exits 1 when the file is stale; `helpIndex.test.ts` runs it,
  so `npm run validate` fails until the index is rebuilt after a guide changes.
- `src/lib/helpIndex.ts`: `searchHelp` (word and six-letter-stem matching, headings and titles
  weighted), `readHelp(ref)` (a section or page, capped at 12,000 chars with a note),
  `helpContents()` (the page and section list, in the cached system text).
- Tools `search_help` and `read_help` (researchAssistantTools.ts) in both assistants. Each read is
  recorded; code appends `Guides read for this answer: Title (/knowledge/...)` and the drawer and
  card render those paths as links (`AssistantMessageText`).
- The shared loop (`assistantLoop.ts`: `runAssistantLoop`, `sourceLines`, page checks) is used by
  both assistants; `MAX_TOOL_ROUNDS` moved there.

## Behaviour

- One chat per project (Tools, Research assistant). Context per message: project fields, report
  narrative, accepted insights (60), accepted recommendations (40), objective coverage statuses,
  accepted findings rated robust or use_with_caution (80), and the last 20 messages.
- Four jobs: answer from that evidence; answer data questions through tools; give method advice,
  with `sample_size` for every number; `revise_narrative` for report edits (unchanged).
- Tool loop, at most `MAX_TOOL_ROUNDS = 8` model calls per message. `revise_narrative` is
  terminal. Running out of rounds gives "I stopped after 8 steps without a final answer..." plus
  the tables built so far; it is never shown as a complete answer.
- Unfinished responses (Codex B5-F03): a response whose `stop_reason` is not `end_turn`,
  `tool_use` or `stop_sequence` ends the loop; its text is dropped and none of its tool calls
  runs (a cut `revise_narrative` would write a half field). `max_tokens` gives `CUT_OFF_REPLY`
  ("My answer was cut off before it finished, so it is not shown. Ask again, or ask something
  narrower."); other stops name the reason. An empty finished answer gives `EMPTY_REPLY`. Tables
  built in earlier rounds stay listed. `LoopResult.incomplete` records all three cases.
- Storage: the question and its reply are inserted together in one transaction after the reply
  exists, checked against the run and tenant in the same statement (user row then assistant row,
  1 ms apart for order). A failed call stores neither, so sending the question again stores it
  once. Earlier the question was stored first and a failure left it unanswered.
- A code-appended line lists every table built for the reply:
  `Tables built for this answer (drafts under Cross tabs, All tables): "label" from file.`
  It comes from the tool results, not the model's text.

## Tools (`src/lib/researchAssistantTools.ts`)

| Tool | What it does | Failure |
|---|---|---|
| `list_data_files` | This run's `documents` of kind `table` that are stats files or raw case tables | none: "no data files" text |
| `find_variables` | `searchVariables(dict, query)` from crosstabAsk.ts (shared with SemanticTabs) | dictionary read failure is an error result |
| `build_table` | `checkTablePlan` (the SemanticTabs validator), then `buildCrosstab(... source: "assistant")` | validation errors returned for the model to fix; set-up read failure stops the table |
| `sample_size` | `sampleSizeForMargin` / `marginForSample` | options checked before defaults (below); invalid input is an error result |

- Ownership: `data_file_id` must be one of this run's data files (tenant-scoped read); anything
  else is refused before any read.
- Weight: `defaultWeight(dict)` unless `weighted: false`. Design: `loadDataSetupWithStatus` then
  `resolveSurveyDesign(dict, effectiveDesignChoice(...))`, as Objectives evidence does. A failed
  set-up read returns an error; it is not treated as "no design".
- `MAX_TABLES_PER_MESSAGE = 4`; the fifth `build_table` returns an error asking the model to
  answer from the tables built.
- Read-back after a build (Codex B5-F04): once `buildCrosstab` returns, the draft exists. A failed
  `loadCrosstab` (thrown or no result) returns an error result that still carries the table
  (`readBack: false`, label `Table <id>`): it counts towards the cap, the model is told not to
  build it again, and the reply's table line marks it "(saved, but its figures could not be read
  back)".
- `sample_size` options (Codex B5-F02): `mode` must be one of the two; each option given must be
  a finite number, or it is refused with its name ("confidence_pct must be a number, not \"99\"");
  only an absent or null option takes its default; the mode's required value must be present.
- The result text the model sees is `insightTableText(result)` (bases, significance marks) plus
  notes: label and id, weighted or not, design used or not, plan `unclear` lines, skipped
  variables, and a truncation note.

## Persistence

- Tables are ordinary `document_tables` drafts; `crosstab.source = "assistant"`. `listCrosstabs`
  maps the source, and All tables shows a "Research assistant" badge
  (`data-testid="crosstab-assistant-badge"`). Commit and delete work as for any draft.
- No new table, column or migration.

## Sample size method (`src/lib/sampleSize.ts`)

One model in both directions (Codex B5-F01). Margin: e = z sqrt(deff p(1-p)/n), times
sqrt((N-n)/(N-1)) with N (`marginFraction`, unrounded; `marginForSample` rounds to 2 dp). Sample:
that formula solved for n, n0 = z^2 deff p(1-p) / e^2 (Cochran 1977 ch. 4, design effect inside
the variance after Kish 1965), then n0 / (1 + (n0 - 1)/N) = n0 N / (N + n0 - 1) with N, rounded
up: the smallest whole n whose margin is at most e, never more than N. Approach = completes /
response rate, refused when more than N. Earlier the design effect multiplied after the finite
population correction (556 instead of 435 at e 5, N 1000, deff 2; 160 for N = 100). z for
90/95/99 only. Invalid inputs (margin outside (0, 50), p outside
(0, 100), deff outside [1, 10], N not an integer >= 2, n > N) throw.

Limits stated in code and in the knowledge base: probability-sample proportion only; for quota or
opt-in samples the figure describes a random sample of that size; deff is the user's estimate,
not estimated from data; the margin is whole-sample, subgroups need their own.

## Tests

- `src/lib/__tests__/sampleSize.test.ts` (8; B5-F01 adds the combined references 435 and 89, an
  independent enumeration oracle over 576 combinations of confidence, margin, design effect,
  population and share, and the response-rate refusal with a feasible recovery). Earlier (6): reference values 385, 1068, 278, 577, 664 (99%),
  246 (p = 20%), margins 3.1 (n = 1000), 4.9 (n = 400), 3.8 (n = 500 of N = 2000), and every
  invalid input.
- `src/lib/__tests__/researchAssistantTools.db.test.ts` (6, real disposable PostgreSQL for the
  run, documents and stored messages; model, dictionary, build and set-up mocked): a data question
  through the full loop (assistant source, default weight, figures with bases and marks, the
  code-written table line, the cached system block); another project's file and an unknown
  variable refused with nothing built; a failed dictionary or set-up read stops the table; an
  unweighted request; sample sizes from the calculator; the four-table cap and eight-round stop.
- `e2e/ui/research-assistant-tools.check.mjs` (native browser, scripted model replay): a data
  question builds an assistant draft (checked in the database, `crosstab->>'source' =
  'assistant'`), the reply lists it, the sample size reply quotes 385, and All tables shows the
  badge.

Added with the drawer:
- `src/lib/__tests__/helpIndex.test.ts` (4, no mocks): the index is current; every article and
  manual page is present with links; search ranks the sample size section first for a sample size
  question, stems, stop words; read of a page, a section, unknown refs, truncation.
- `src/lib/__tests__/generalAssistant.test.ts` (3, model mocked, no database): history and page
  checks; only help and calculator tools offered; turns alternate; guide line; usage to the log;
  calculator error result; empty message refused.
- researchAssistantTools.db.test.ts (+2): a how-the-app question reads a guide and links it, the
  page line is in the uncached system part; an unknown guide ref is an error.
- `e2e/ui/assistant-drawer.check.mjs` (native browser, replay model): dashboard question answered
  from a guide with a working link; chat kept on the guide page; Esc and focus; inside a project
  the scope names Findings; a dropped load shows Try again and recovers; the exchange is saved and
  shown in the Research assistant section, where the button is hidden.

## Not covered

- (Closed 2026-10-23.) Usage outside a project was in the server log only; it is now recorded in
  `tenant_api_usage` (migration 0109, `logTenantApiUsage`) and shown on the dashboard Overview
  for the last 30 days (`loadTenantUsageOutsideProjects`: calls, input with the cached part,
  estimated cost via `costOfUsage`). A failed write is logged with its figures; a failed read is
  shown as such, and a missing table says it needs 0109.
- Late-reply ordering in the drawer (a reply arriving after moving to another project) is by
  design and reviewed, not exercised by a browser check (the replay answers instantly).
- The guide search is lexical; a question phrased far from the guide's words may miss it.

- A live-model run: the browser check uses a scripted replay, so the model's tool choices and
  wording on real questions are unverified.
- The model's sentence can still misstate a figure from a table it built; nothing compares the
  reply text with the table.

## Request identity and lost replies (Codex B6-F01, B6-F02, 2026-10-23)

- B6-F01: only the response that ends the turn is the answer. Text written beside tool calls in
  earlier rounds is dropped; an empty final response gives `EMPTY_REPLY` (tables already built
  stay listed). Running out of rounds gives only the stop message.
- B6-F02, migration `0108_assistant_message_request_id.sql`: `assistant_messages.request_id uuid`
  (nullable) and a unique index on (run_id, request_id, role) where request_id is not null.
  - The drawer and the card make a request id (`crypto.randomUUID()`) for each question; Send
    again, or the same text sent unchanged from the box, reuses the failed question's id.
  - `askResearchAssistant(..., requestId)`: an id that is already answered returns the stored reply
    (`alreadyAnswered: true`), no model call, nothing stored. Otherwise the pair is inserted with
    `on conflict ... do nothing`; when a racing send stored first, this one returns that stored
    reply. A revision of the report is not made again for an answered request. An invalid id is
    refused.
  - Drawer: after any failed send in a project the history is read back with request ids
    (`loadAssistantMessages` -> `loadAssistantConversation(..., true)`); a failed question whose
    request has a stored answer is cleared and the answer shown. A rejected action (connection
    lost: the outcome is unknown) shows "No answer arrived" until the read-back settles it; a
    server error (known: nothing stored) shows "Not answered". Outside a project nothing is
    stored, so every failure is "Not answered" and has no request id on the server.
  - Card: the same request id reuse; a lost connection refreshes the page data so a stored answer
    appears, with a message saying so.
  - The run page reads the conversation without the request id, so it does not depend on 0108;
    sending in a project, and the drawer's read, say "This needs migration 0108 applied first"
    when it is missing.
- Tests: `researchAssistantTools.db.test.ts` (empty final answer after a tool round, with a table
  and healthy; answered request returned without a model call or a second store; racing sends
  store one pair; invalid id). `assistant-drawer.check.mjs` third test (an answer stored but its
  reply lost while the project is open and after moving away, shown on read-back with no failure;
  a model error is "Not answered" and Send again answers it once; the database holds each pair
  once). The replay stand-in answers a fixture rule with `status` as a provider error.

## One execution per request (Codex B7-F01, 2026-10-23)

The unique pair insert (0108) kept one stored pair, but two overlapping sends of one request both
ran the model and tools first (two draft tables, or two report revisions). Now
`askResearchAssistant` with a request id claims the request before anything runs:

- `withRequestClaim`: a Postgres session advisory lock (`pg_try_advisory_lock(hashtextextended(
  'assistant-request:<run>:<request>', 0))`) on one pooled connection kept for the answer,
  outside any transaction. A second send of the same request polls every 250 ms; when it gets the
  claim it re-reads the stored answer and returns it (`alreadyAnswered: true`) without a model
  call. The claim is released in `finally`, and by Postgres if the connection or process dies.
- Waiting is bounded by `requestClaimWaitMs()` (5 minutes, or `ASSISTANT_REQUEST_WAIT_MS`); past
  it the send fails with `RequestInProgressError`, having run and stored nothing. The action
  returns `stillRunning: true`; the drawer shows "Still being answered" (kind `running`) and the
  card "Still being answered: ...".
- Distinct requests do not wait for each other. A send without a request id (none of the app's
  callers) is not claimed.
- Guarantee: within one database, two sends of one request never run the model or tools at the
  same time, and a later send sees an earlier one's stored answer.
- A send that fails part way does not have its work repeated by the retry (Grant: "shouldn't this
  be fixed?", 2026-10-23):
  - Report revisions: `revise_narrative` no longer writes when the model calls it. The revision
    is applied in the same transaction that stores the question and its reply
    (`applyNarrativeRevision(client, ...)`); a failed store rolls the revision back, so a revision
    exists only with its stored answer and a retry applies it once. A refused revision
    (`RevisionRefused`: no report, unsupported figures) writes nothing and its reason is the reply.
  - Tables: `buildCrosstab(..., { assistantRequest: { id, key } })` stores the request id and a
    SHA-256 key of the exact table request (file, columns, rows, weight, filters, design) on the
    draft. Before building, `build_table` looks for a draft of this run and file with the same
    request id and key and reuses it ("built for this question by an earlier attempt and is
    reused, not built again"). A different table request for the same question is built; the same
    table request for another question is built separately. Within one turn a repeated table is
    listed and counted once.
  - What a failed send can leave is draft tables (listed under All tables), which its retry reuses.
- The holder keeps one pooled connection while the model works; a waiting send borrows a
  connection only for each try. A failed unlock destroys that connection instead of returning it
  to the pool still holding the lock.

Tests (real database, model mocked; the build mock records each build and saves a draft row with
its assistant request, as the real builder does): a send that builds a table and then fails leaves
one draft, and the retry reuses it (no second build) while a different table is built, and another
question builds its own; a revision whose answer cannot be stored (a check refusing the reply)
leaves the report unchanged and stores nothing, the retry applies it once, and a replay does not
revise again (a hand edit made after it stays). Overlap: overlapping sends with the first held at a gate:
one model execution (2 calls), one build, the second returns the stored answer, a later replay
makes no model call; a first send that fails lets the waiting send run once (one build, one
pair) while an unrelated request is answered during the hold; a wait past a 500 ms limit is
`RequestInProgressError` with no model call, and the first still answers.
