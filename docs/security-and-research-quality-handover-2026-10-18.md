# Handover: storage-checker repair, benchmark harness, sign-in (G6) and Research Quality Review v1 — 2026-10-18

Status: **implemented, ready for Codex review.** Authorised by Grant on 2026-10-18 (06:40: security and Research Quality Review; 07:15: storage-checker repair and benchmark completion; 08:02: the brief and proposal rubric). Nothing pushed or deployed; no development or live database touched. Overall acceptance and public release remain open.

## Commits on the laptop checkout

| Commit | Package | Contents |
|---|---|---|
| `a9cb5de` | b21 | Storage-privacy checker repair (Codex formal verdict on `4475adc`) |
| `20977c8` | b22 | Real-model benchmark harness: computed tables first, step log, step timeout |
| `ed3e980` | b23 | Sign-in, organisations, per-request tenant, signed conversion requests (G6, IMP-001) |
| `d45c0a2` | b24 | Research Quality Review v1 with the RQC-2 brief and proposal rubric, and the Windows run kit |

Exact hashes are in each package's `hashes.txt` under `.fnd001/overnight/b21` to `b24`.

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

## Checks run in this workspace

All on the combined tree (b21 to b24), 2026-10-18:

- `npx tsc --noEmit`: pass. ESLint on every changed file: no new errors (the 13 reported are pre-existing in `RunShell.tsx` and two older test files, identical at HEAD).
- `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres npx vitest run src/lib/__tests__ --pool=forks`: **138 files, 990 passed, 0 failed, 59 skipped** (46 skipped as before plus the 13 real-model cases, which run only through the gateway).
- `next build --webpack` (production): pass; the proxy and the new export route are listed.
- Browser, production build on the disposable stack with the Auth stand-in, signed in: `npx playwright test -c e2e/ui/ui-check.config.mjs` **41 passed, 1 skipped** (the real-model check, which skips on replay); `npx playwright test` smoke **1 passed**; adapter checks **2 passed**; `node scripts/e2e/objective-review-acceptance.mjs` **passed**.
- Failed-run history kept: the first full browser run after sign-in had 3 failures and the smoke and adapter runs lacked their environment variables. Two failures (`over-limit-refusal`, `concurrent-limit-uploads`) were uploads over 10 MB cut off by the proxy's body buffer ("Unexpected end of form"), fixed by `proxyClientMaxBodySize`; the third (`decision-refresh-failure` own add/delete/accept) passed unchanged on rerun and in the final run (timing, not reproduced). The first harness self-test hung at the multiple-response set's "Row (all)" button; fixed in b22.
- b23 on its own (HEAD plus b23, page.tsx without the Research Quality wiring): `tsc` pass; requestTenantCoverage, authSession, parseRequestSignature, safeNextPath, signedInTenantAccess, tenantIsolation and findingWording: 21 passed, 2 skipped.
- Research Quality real-model harness self-test against the replay server on the gateway port: all 13 cases ran to completion and wrote `research-quality-model.json` (grades on replay are meaningless and not reported).

## What used mocks versus real infrastructure

- Real: PostgreSQL 16 disposable databases with all migrations, non-owner roles without BYPASSRLS, the actual actions, routes, repository, Python verifier and production build; Chromium against `next start` of the production build.
- Stand-ins: Supabase Auth and Storage (the stack's in-memory stand-ins; `fetch` stubs in unit tests), the model (deterministic stand-ins in vitest, explicit replay in the browser). Replay and stand-in answers are orchestration evidence only, never judgement quality.

## Remaining and for Grant

- Run the Windows kit (`scripts/e2e/REAL-MODEL-RUN.md`): the golden-thread benchmark and the 13 Research Quality Review semantic cases through one gateway capped at US$7. Recorded spend is US$4.018694 of the US$12 cap.
- Apply migrations 0104 and 0105; add yourself with `add-member.mjs`; disable email sign-ups in the cloud project's Auth settings.
- Deployed G1 to G6 checks remain on Grant's machine (`scripts/release-gate/README.md`).
- Human-edit provenance outside Research Quality Review still records a time but not the person.
- Research Quality Review limits: PDF, DOCX and TXT only; no OCR; one structured observation per criterion and decision; reference curation not done; downstream propagation into findings, insights or exports is deliberately out of v1.
