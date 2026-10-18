# Handover: storage-checker repair, benchmark harness, sign-in (G6) and Research Quality Review v1 — 2026-10-18

Status: **implemented, ready for Codex review** (repairs after Codex's review are listed below). Authorised by Grant on 2026-10-18 (06:40: security and Research Quality Review; 07:15: storage-checker repair and benchmark completion; 08:02: the brief and proposal rubric). Nothing pushed or deployed; no development or live database touched. Overall acceptance and public release remain open.

## Commits on the laptop checkout

| Commit | Package | Contents |
|---|---|---|
| `a9cb5de` | b21 | Storage-privacy checker repair (Codex formal verdict on `4475adc`) |
| `20977c8` | b22 | Real-model benchmark harness: computed tables first, step log, step timeout |
| `ed3e980` | b23 | Sign-in, organisations, per-request tenant, signed conversion requests (G6, IMP-001) |
| `d45c0a2` | b24 | Research Quality Review v1 with the RQC-2 brief and proposal rubric, and the Windows run kit |
| `22555fe` | b25 | Repair after Codex: omitted-effect measurement on saved statistics (20977c8) |
| `7ca0848` | b26 | Repair after Codex: sign-in redirect and refresh-only outage (ed3e980) |
| `35af43a` | b27 | Repair after Codex: Research Quality lease expiry, purge ordering, interrupted retry (d45c0a2) |
| `fdac176` | b29 | Second repair: benchmark affirmative attribution (22555fe) |
| `37193d6` | b30 | Second repair: lease expiry judged at the write after a lock wait (35af43a) |
| `6bb2a3f` | b32 | Third repair: possible, conditional and question sentences not counted (fdac176) |
| `1e0f2a3` | b33 | Third repair: task row locked before the lease is judged; one run lock for review creation (37193d6) |

Exact hashes are in each package's `hashes.txt` under `.fnd001/overnight/b21` to `b34`.

## 1. Storage-privacy checker (b21)

Codex found `scripts/release-gate/check-storage-privacy.mjs` read every non-200 answer as a refusal. Now any 2xx (including 206) is FAIL; 400/401/403/404 are refusals for object reads, 400/401/403 for the expired link, and only after the server key has read the same object; anything else (no answer, 3xx, 408, 429, 5xx) is COULD NOT CHECK. `--no-sign` records expiry as SKIPPED, so the summary cannot read ENFORCED without it. The exit code is set through `process.exitCode`, because `process.exit()` aborted on Windows (3221226505) before returning the result.

Tests: `releaseGateStorage.test.ts`, 18 passed, including Codex's original counterexamples (500, 503, reset, 206), 429, 302, a 404 on the expired link, `--no-sign`, and outage then recovery. Codex should rerun its unchanged counterexample servers against `a9cb5de`. A passing local check still says nothing about the deployed bucket.

## 2. Benchmark harness (b22)

The 2026-10-18 real-model run spent US$0.201378 (gateway estimate) and was incomplete: no computed tables existed, so claims were judged only against each other. `e2e/ui/real-model-quality.check.mjs` now commits six crosstabs by Gender through the native controls first (Purchase, Satisfaction, Recommend, the Reasons multiple-response set, NearTie, SmallGroup), stops as incomplete if no computed finding results, logs each step, and fails a missing control after three minutes instead of holding the hour-long test. Validated on replay: 18 computed findings, pipeline settled, measurements written (replay extracts no report claims, as expected).

## 3. Sign-in and organisations (b23)

See `docs/sign-in-and-organisations.md` for behaviour, setup and evidence. In short: Supabase Auth email and password; `tenant_memberships` (migration 0104) with a select-only, user-keyed row-level-security policy; `requestContext.ts` decides the tenant per request; every page, server action and route handler uses it (source scan test); the proxy refreshes sessions; outage is 503 or an error page, never sign-out and never a fallback organisation; the Python conversion function now takes an HMAC-signed, five-minute, single-file request instead of the shared secret; `proxyClientMaxBodySize` matches the 100 MB upload limit (an upload over 10 MB was cut off through the proxy until this was set).

Changed callers: the 49 files that read `DEFAULT_TENANT_ID` (every `*Actions.ts`, all export routes, the three data pages), the two progress routes (now ownership-checked), `parseStatsFile.ts`, `api/parse-stats-file.py`, `GlobalShell.tsx`, `next.config.ts`. Test-only: 32 test files gained a `requestContext` mock that supplies the seeded tenant; the disposable stack gained an Auth stand-in, three synthetic accounts and signed-in browser state, and stopped setting `DEFAULT_TENANT_ID`.

Migration: **0104_tenant_memberships.sql** (Grant applies). After it, add yourself with `node scripts/auth/add-member.mjs <email> --role owner` so the existing projects stay visible.

## 4. Research Quality Review v1 (b24)

Implemented from the 2026-10-16 brief and fit assessment, with Grant's three earlier decisions (DOCX preview side effect allowed, time-only identity now replaced by the signed-in person, no monetary cap with the estimate shown first) and the 2026-10-18 rubric.

- **Rubric RQC-2** (`src/research-quality/criteria/RQC-2.json`, 27 criteria). Brief: background, business problem, decision, three or more objectives on the app's objective criteria (code caps the score at Weak with fewer than three cited objectives), methodology parameters, deadline, budget. Proposal: literature review, restatement, added objectives, methodology, design, sample, analytical plan, products, timeline, budget; restatement, added objectives, products, timeline and budget are compared with the brief when one is selected and assessed on their own otherwise, and each result says which. Plus documented-study design, inference scope, instrument coverage and wording, alignment, plan versus execution, qualitative process and mixed-methods integration.
- **Scoring.** Every criterion has its own score on the app's scale (Strong 5, Workable 3, Weak 1) plus Absent 0, and an improvement suggestion when not Strong. Code keeps the score consistent with what was documented (nothing documented is Absent; something documented is never Absent; unreadable material is not rated). Scores are never added together; the three assessments (documentation, methodology, decision fitness) stay separate.
- **Pipeline.** Snapshots (no model) → extraction with exact quotes that code locates in the pinned text → deterministic criterion selection → assessment per criteria group, validated before publication → presentation without a model call. Leases block late results; each task runs at most twice (one explicit retry); a review reserves at most 20 attempts.
- **Screen.** Section "Research quality review" under Objectives, with Overview (scorecard), Documents (roles, versions, purge), Alignment, Improvements, Clarifications, and History and export. "Review research quality" on a document in Reports and decks opens it preselected. Opening the section makes no model call.
- **References.** The production catalogue (RQR-1) has no approved entries: two real draft entries (COREQ, DOI 10.1093/intqhc/mzm042; the AAPOR non-probability task force report) await curation, so production recommendations say "insufficient reference support". The synthetic catalogue (RQR-T1) is used only when `RESEARCH_QUALITY_REFERENCE_CATALOGUE=synthetic-test` and is labelled wherever shown.
- **Export.** `/api/runs/[id]/research-quality/export?review=<id>` builds the DOCX from the same view model.

Migration: **0105_research_quality_review.sql** (seven tables, row-level security, tenant-scoped composite keys). Without it every action returns a setup message before any write or model call.

## Repairs after Codex's independent review (2026-10-18, afternoon)

Codex accepted `a9cb5de` and requested changes on the other three (`docs/four-package-independent-review-2026-10-18.md`). Each repair is a separate commit on top of `1e22cb2`; nothing in `a9cb5de` was touched. Status: **implemented, ready for Codex review.**

**b25, benchmark measurement (20977c8).** The omitted-effect measurement now lives in `e2e/ui/omitted-effect-measure.mjs`. Computed findings are matched on their saved statistics (question, answer, banner variable, banner column, column value), never their wording; the effect is found only when every target group has a finding at its value and the expected group is higher. An insight states the effect only when a sentence names the answer and each group is named as a whole word with a percentage in its own clause, at the right value. A missing target table reads "could not be measured", not "not found". `omittedEffectMeasure.test.ts` (6 tests) covers Codex's two counterexamples (split 70/50 findings now found; repeated female-only text now "one group only"), reversed groups, wrong values, unrelated figures, other answers, stated-origin findings, wording without statistics and the missing table. Run on Codex's saved replay evidence (`b22-saved-evidence.json`), the computed findings match and the female-only insight is classified "mentions one group only". The six tables, step bounds, failed-table refusal and "not extracted on replay" labels are unchanged; no replay result is a model score.

**b26, sign-in (ed3e980).**
- Open redirect: `safeNextPath` refuses control characters and backslashes, parses what remains with browser URL rules against a placeholder origin, and returns only the parsed path, query and fragment when it stays there. `/\t/evil.example/`, newline, carriage return, NUL, backslash, protocol-relative, absolute and `javascript:` destinations all go to `/`; in-app paths with query and fragment are kept.
- Refresh-only outage: with the access cookie gone and the refresh cookie present, `requestContext` now treats the request as a renewal the proxy could not complete (a rejected refresh never reaches it: the proxy signs the visitor out), so routes answer 503 and pages error, cookies are kept, and the same request recovers in the same organisation once Auth answers.
- The obsolete comment in `api/parse-stats-file.py` about sending the shared secret is replaced by one that matches the HMAC signing.
- Tests: `safeNextPath.test.ts` (3 tests, every refused value also checked by resolving it the way a browser would); `signedInTenantAccess.db.test.ts` +3 (the actual proxy followed by the actual route: outage 503 with cookies kept, recovery in organisation A, a rejected refresh token is a genuine 401 with cookies cleared). Browser: `sign-in-access.check.mjs` gained the seven sign-in destinations (with every external request blocked before dispatch) and the refresh-only outage with a full-session control, recovery and a rejected refresh.

**b27, Research Quality task lifecycle (d45c0a2).** No migration change.
- Every result write (extraction, assessment and failure) requires the current, unexpired lease (`lease_expires_at > now()`). A refused late answer still adds its token usage to the cost totals, because the call was paid for.
- Purge and publication are serialised: publication locks the source versions it rests on FOR SHARE (an extraction's pinned version and cited versions; for an assessment, every version in the review's manifest, since its reasoning may paraphrase any), purge locks them FOR UPDATE, both in id order and before touching task rows. If the purge commits first, publication refuses and the task fails with no attempts left and a "start a new review version" message; if publication commits first, the purge blanks it as before.
- Explicit retry treats an expired running task as interrupted: it is reset to pending within its attempt bound and rerun; a live lease is never taken over; an interrupted extraction after assessments have published, and a task out of attempts, get a visible new-review explanation. A retry with nothing to do no longer leaves the review marked "running".
- Tests: `researchQuality.db.test.ts` +5 (expired lease for extraction, assessment and failure, with usage counted and the current lease publishing; purge before a late extraction and assessment, with tasks, observations, view and DOCX free of the text and an unrelated source untouched; both overlap orders made deterministic by holding the task row so the publication waits inside its transaction; retry with a live lease, an interrupted assessment, a repeat, exhausted attempts and an interrupted extraction after publication; an interrupted extraction before publication resumed to a complete review). Codex's unchanged recovery probe, copied in temporarily: 16 passed, 0 failed (it was 13 passed, 3 failed on `d45c0a2`). Each new test was also run against the released code and fails there.

## Second repairs after Codex's six-repair review (2026-10-18, late afternoon)

Codex accepted `7ca0848` (sign-in) and kept `a9cb5de` accepted; it requested changes on two remaining boundaries (`docs/six-repair-independent-review-2026-10-18.md`). Both are fixed on top of `add3962`; nothing in the accepted commits was touched. Status: **implemented, ready for Codex review.**

**b29, benchmark affirmative attribution (22555fe).** `readTextAttribution` in `e2e/ui/omitted-effect-measure.mjs` now counts an insight's figure for a group only when the text affirmatively attributes it to the answer: a sentence that negates or hedges is not read as asserting anything; a clause's group figure counts if the clause names the answer, or if it is a bare group figure ("than to women (50%)") and the same sentence anchors the answer (a clause naming it with its own group figure, or a "Convenience:" label); any other group figure ("50% of women reported good service") is not counted and is reported as unestablished. Codex's two counterexamples ("Convenience was not measured, while 70% of men and 50% of women reported good service"; "Convenience is not chosen by 70% of men or 50% of women") are now "mentions the answer and group figures without establishing the effect (not counted)". The structured computed-finding match, one-group, reversed, wrong-value, other-answer, missing-table and stated-origin behaviour are unchanged. `omittedEffectMeasure.test.ts`: 7 tests (one new with Codex's two cases, six further near-misses and three affirmative controls); 2 fail on `22555fe`. Codex's probe (`benchmark-independent.mjs.probe.txt`, only its Windows path changed): 7 of 7 pass (5 of 7 on `22555fe`).

**b30, lease expiry after a lock wait (35af43a).** PostgreSQL's `now()` is the transaction's start time, so a publication that waited on a source lock was judged by the time it started. Every lease comparison and expiry in `researchQualityRepository.ts` (the shared `CURRENT_LEASE` used by extraction, assessment and failure writes, `claimTask`, `loadTasks.lease_expired` and `resetFailedTasks`) now uses `clock_timestamp()`. The UPDATE also takes the task row lock, so a reclaim cannot slip in between the check and the commit (it waits, then re-reads the row). Source-lock ordering, atomic task/result writes and paid-attempt accounting are unchanged. `researchQuality.db.test.ts` +1: for extraction and assessment, a publication held on its source lock until its lease has run out (checked from another session before release) is refused with nothing published; reclaimed, the same wait with a live lease publishes. It fails on `35af43a`. Codex's `independent-lock-expiry.probe.txt`, unchanged: 19 of 19 pass (18 of 19 on `35af43a`).

Checks on the tree with b29 and b30: `npx tsc --noEmit` pass; ESLint on the changed files clean; full vitest **139 files (138 passed, 1 skipped), 1008 passed, 0 failed, 59 skipped**; production build pass; browser on the new build **49 passed, 1 skipped**; benchmark harness self-test on replay **1 passed** (18 computed findings; omitted effect "found in the computed findings; no insight states it"; both one-group insights still "mentions one group only"); smoke **1 passed**; adapter **2 passed**; objective acceptance **passed**. No failed runs in this round.

## Third repairs after Codex's second-repair review (2026-10-18, evening)

Codex (`docs/second-repair-independent-review-2026-10-18.md`) confirmed the original cases of both second repairs but found three further boundaries. Fixed on top of `4dfc2d3`; accepted sign-in, storage, purge and retry are untouched. Status: **implemented, ready for Codex review.**

**b32, benchmark: not-asserted statements (fdac176).** The sentence filter (`NOT_ASSERTED`, replacing `NEGATION`) now also refuses possibility, condition, prediction, supposition and questions: modal verbs (might, may, could, would, should, can), if/whether/unless, assume/suppose, likely/probably/possibly/perhaps, expected/predicted/projected/forecast, plan/aim/target/hope, and a trailing question mark. Such a sentence is reported as "not asserted ..." and the insight as "mentions the answer and group figures without establishing the effect (not counted)". The comments now say exactly this. `omittedEffectMeasure.test.ts` +1 (Codex's two sentences, seven more uncertain forms, three affirmative controls), 8 tests; the new one fails on `fdac176`. Codex's expanded probe: 9 of 9 (7 of 9 on `fdac176`); its original seven: 7 of 7.

**b33, Research Quality lease after a task-row wait, and concurrent starts (37193d6).**
- Every result write (extraction, assessment, failure, purge discard) now locks the task row with a separate `select ... for update` after any source locks and before the lease UPDATE, so the lease is judged with `clock_timestamp()` after the wait. (PostgreSQL decides an UPDATE's WHERE before waiting on a row lock and does not re-check it when the holder releases without changing the row.)
- `createReview` takes the run row once, `FOR UPDATE`, checking tenant ownership there, and checks the request key only after it. The previous `FOR SHARE` then `FOR UPDATE` upgrade let two concurrent starts deadlock (40P01).
- `researchQuality.db.test.ts` +2, 21 tests: extraction, assessment and failure writes held on the task row until the lease ran out are refused (usage still counted, nothing published), and the same wait with a live lease records; two starts with the same key forced to arrive together return one review (one created), two different keys get consecutive sequences, a sequential repeat returns the existing review, and another organisation is refused and creates nothing. Both fail on `37193d6`. Codex's unchanged probes: task-row wait 19 of 19 (18 of 19 on `37193d6`); concurrent start 20 of 20 (18 of 20).

Checks on the tree with b32 and b33: `npx tsc --noEmit` pass; ESLint on the changed files clean; full vitest **139 files (138 passed, 1 skipped), 1011 passed, 0 failed, 59 skipped**; production build pass; browser **49 passed, 1 skipped**; benchmark harness self-test on replay **1 passed** (18 computed findings; "found in the computed findings; no insight states it"); smoke **1 passed**; adapter **2 passed**; objective acceptance **passed**. No failed runs in this round.

## Checks run in this workspace

All on the combined tree (b21 to b24), 2026-10-18:

- `npx tsc --noEmit`: pass. ESLint on every changed file: no new errors (the 13 reported are pre-existing in `RunShell.tsx` and two older test files, identical at HEAD).
- `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres npx vitest run src/lib/__tests__ --pool=forks`: **138 files, 990 passed, 0 failed, 59 skipped** (46 skipped as before plus the 13 real-model cases, which run only through the gateway).
- `next build --webpack` (production): pass; the proxy and the new export route are listed.
- Browser, production build on the disposable stack with the Auth stand-in, signed in: `npx playwright test -c e2e/ui/ui-check.config.mjs` **41 passed, 1 skipped** (the real-model check, which skips on replay); `npx playwright test` smoke **1 passed**; adapter checks **2 passed**; `node scripts/e2e/objective-review-acceptance.mjs` **passed**.
- Failed-run history kept: the first full browser run after sign-in had 3 failures and the smoke and adapter runs lacked their environment variables. Two failures (`over-limit-refusal`, `concurrent-limit-uploads`) were uploads over 10 MB cut off by the proxy's body buffer ("Unexpected end of form"), fixed by `proxyClientMaxBodySize`; the third (`decision-refresh-failure` own add/delete/accept) passed unchanged on rerun and in the final run (timing, not reproduced). The first harness self-test hung at the multiple-response set's "Row (all)" button; fixed in b22.
- b23 on its own (HEAD plus b23, page.tsx without the Research Quality wiring): `tsc` pass; requestTenantCoverage, authSession, parseRequestSignature, safeNextPath, signedInTenantAccess, tenantIsolation and findingWording: 21 passed, 2 skipped.
- Research Quality real-model harness self-test against the replay server on the gateway port: all 13 cases ran to completion and wrote `research-quality-model.json` (grades on replay are meaningless and not reported).

Checks on the repaired tree (b25 to b27 on top of `1e22cb2`), 2026-10-18:

- `npx tsc --noEmit`: pass. ESLint on the changed files: no new errors.
- `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres npx vitest run src/lib/__tests__ --pool=forks`: **139 files (138 passed, 1 skipped), 1006 passed, 0 failed, 59 skipped**; the 16 more than before are the new tests above.
- The new tests against the released code (`git show HEAD:` copies of the changed sources): `safeNextPath` 3 failed; `signedInTenantAccess` refresh-outage case failed; the 5 new Research Quality cases failed. Codex's unchanged `independentResearchQualityRecovery` probe on the repaired code: 16 passed.
- `next build --webpack` (production): pass.
- Browser, production build on the disposable stack: `npx playwright test -c e2e/ui/ui-check.config.mjs` **49 passed, 1 skipped** (the real-model check, which skips on replay); Codex's unchanged `independent-login-next-continuation` and `independent-refresh-outage` probes **3 passed**; smoke **1 passed**; adapter checks **2 passed**; `objective-review-acceptance.mjs` **passed**; harness self-test of `real-model-quality` on replay **1 passed** (six tables, 18 computed findings, omitted effect "found in the computed findings; no insight states it", both one-group insights classified "mentions one group only" and anchored on the target findings; replay, not a quality result).
- Failed-run history kept: the first run of the new refresh-only browser check failed at recovery (401). The stack's Auth stand-in revokes every refresh token of a user on sign-out, while real Supabase with `scope=local` (what the app sends) revokes only that session; the main sign-in check signs the primary user out, which spent the shared stored session the new check relied on. The check now signs in for its own session; the stand-in is unchanged (stricter than Supabase). Replayed by hand on the repaired build with a fresh session, the same sequence gave 503 (route), 500 (page) and then 200 after recovery.

## What used mocks versus real infrastructure

- Real: PostgreSQL 16 disposable databases with all migrations, non-owner roles without BYPASSRLS, the actual actions, routes, repository, Python verifier and production build; Chromium against `next start` of the production build.
- Stand-ins: Supabase Auth and Storage (the stack's in-memory stand-ins; `fetch` stubs in unit tests), the model (deterministic stand-ins in vitest, explicit replay in the browser). Replay and stand-in answers are orchestration evidence only, never judgement quality.

## Remaining and for Grant

- Run the Windows kit (`scripts/e2e/REAL-MODEL-RUN.md`): the golden-thread benchmark and the 13 Research Quality Review semantic cases through one gateway capped at US$7. Recorded spend is US$4.018694 of the US$12 cap.
- Apply migrations 0104 and 0105; add yourself with `add-member.mjs`; disable email sign-ups in the cloud project's Auth settings.
- Deployed G1 to G6 checks remain on Grant's machine (`scripts/release-gate/README.md`).
- Human-edit provenance outside Research Quality Review still records a time but not the person.
- Research Quality Review limits: PDF, DOCX and TXT only; no OCR; one structured observation per criterion and decision; reference curation not done; downstream propagation into findings, insights or exports is deliberately out of v1.
