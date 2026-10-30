# Codex instruction: release-readiness audit of the main copy

Purpose: Grant needs evidence-based confidence that Insights Elevator can be released
commercially. Until now each review checked one batch. This audit looks across the whole
application for the classes of defect that batch reviews kept finding, plus the areas a
commercial release needs that no batch has covered. It ends with a release verdict.

## Rules

- Read-only on the application, as in every review. Fresh Git archive, disposable PostgreSQL and
  synthetic data only. No development or live database or storage, no real model call, no
  migration of an existing database, no commit, push or deployment. Do not touch 3001.
- Review the frozen head named in the message. Record commit, tree and the hashes of every
  evidence file.
- Judge against AGENTS.md, the standing engineering requirements and the `claude/*.md` briefs.
- Every finding states its severity, a reproduction or exact source reference, its practical
  consequence, and acceptance criteria. Use S1 (data loss, wrong research result presented as
  correct, security or tenant breach), S2 (wrong or misleading behaviour under realistic
  conditions, or an unrecoverable state), S3 (documentation, maintainability, or an edge with a
  workaround).
- Prove findings with probes against the real code where possible, as before. Mark source-only
  findings as such.
- Separate "defect found" from "not examined". Coverage gaps must be listed, never implied away.

## Part 1. Inventory and risk map (deliver first)

1. Every user entry point: pages, server actions, API routes, background or retry paths, exports
   (Word, PowerPoint, Excel, CSV), the Python engine endpoints and the local worker.
2. Every place a model is called, with its tools, limits and what happens on refusal, cut-off,
   empty output, malformed tool input, timeout and provider outage.
3. Every multi-step write, with its transaction boundary, lock or revision check, and retry
   behaviour.
4. Every calculation exposed to researchers (cross tabs, significance and corrections, weights,
   survey design, NPS, means, drivers, sample size, objective scoring, research quality scores).
5. Rank the areas by consequence and by how little they are tested today. Use this ranking to
   decide where the sweeps below go deepest.

## Part 2. Sweep for the defect classes found so far

For each class, sweep the whole application (not only recent changes) and give a result per
area: defect, clear (with the evidence), or not examined.

1. **Failure shown as success.** An empty, partial, cut-off or failed result shown as a real
   one; `catch` returning empty data; unknown becoming false, zero, empty or a default; a
   fallback sentence that reads like a finding ("No clear pattern emerged" was one).
2. **Model output completeness.** Cut-off (`max_tokens`) or empty answers, text from an
   intermediate step published as the answer, tool calls from an unfinished response executed,
   loops without a bound, a model sentence that contradicts the figures it was given.
3. **Explicit input replaced by a default.** A malformed or out-of-range value silently treated
   as "not given" (the calculator's "99" became 95%); unknown enum values accepted; client input
   trusted at a server action.
4. **Retries and duplicates.** Work that runs twice when a request is retried, raced or replayed;
   side effects (tables, revisions, findings, exports, usage rows) written before the step that
   records success; a lost reply after a committed write; rows duplicated by a retry.
5. **Concurrency and resources.** Lost updates, missing revision checks, locks that do not confirm
   the row exists, lock ordering, connection pool exhaustion (claims or long transactions holding
   connections their own work needs), unbounded waits, timers or handles that never end.
6. **Asynchronous UI state.** Late responses overwriting newer intent, cross-document and
   same-document ordering, "saved" before it is saved, lost drafts, errors shown in the wrong
   project or lost on navigation, controls that silently ignore a click (Send while loading).
7. **Analytical contracts.** Formula, base, weight, design effect and correction applied as the
   label and the guides say; forward and reverse calculations agreeing; reference values checked
   independently; category identity never from wording; unsupported designs refused or
   qualified.
8. **Documentation that contradicts the code.** Knowledge base, Manual, briefs and code comments
   against the actual behaviour (the correction for hand-built tables was described wrongly in
   three places). Missing briefs for new contracts. Comments claiming more than the code does.
9. **One rule in two places.** Duplicated business rules or catalogues that can drift (the
   browser network wordings were one).
10. **Downstream freshness.** A change to source data, wording, settings or eligibility that
    leaves findings, insights, recommendations, narratives or exports stale without saying so.
11. **Migrations and schema.** Each migration additive or safely reversible, re-runnable, and
    tested from the previous state with realistic legacy rows; the app's behaviour when a
    migration is missing; drift between the CLI record and the schema.
12. **Data at rest outside the database.** Temporary files, caches and logs holding respondent
    data, and how long they live (the stats-src cache was one).

## Part 3. Commercial-release areas not yet reviewed

Give a finding, a clear result or "not examinable here, needs ..." for each.

1. **Tenant isolation and security.** Ownership re-checked on every write; RLS on every tenant
   table, including new ones; direct object access by id from another tenant across pages,
   actions, exports and storage paths; secrets only server-side and never logged; dependency
   vulnerabilities (`npm audit`, Python packages) with exploitability noted.
2. **Untrusted content reaching the model or the page.** Uploaded documents and data labels used
   to steer the model (prompt injection: instructions inside a report that change what the
   assistant does or which tools it calls); model or uploaded text rendered as HTML or links in
   the browser or in exports.
3. **Authentication and sessions.** Sign-in, sign-out, organisation switching, expired sessions,
   and what an unauthenticated request to each action returns.
4. **Abuse and cost limits.** Per-request and per-tenant bounds on model calls, table builds,
   upload sizes, file counts and export sizes; what one user can make the system spend.
5. **Personal data and retention.** Where respondent-level data is stored and copied, how a
   project or organisation is deleted (database, storage, caches, exports), and what the
   application can and cannot support for POPIA and GDPR requests. Note what needs legal review
   rather than deciding it.
6. **Operational readiness.** Error visibility (does a server failure reach a log or monitor
   with enough context and without respondent data), health checks, backups and a tested
   restore path, configuration needed for deployment (Vercel limits, environment variables),
   and behaviour when the model provider or storage is down.
7. **Scale.** Behaviour with large files and large projects at the documented limits (rows,
   variables, documents, findings), measured where a disposable run allows, with the limits the
   application states to the researcher.
8. **Accessibility and browsers.** Keyboard access and labels on the main flows, and the
   supported browsers; a targeted check, not a certification.

## Part 4. Release verdict

1. A findings register with every finding from Parts 2 and 3, severity, status and acceptance.
2. A coverage matrix: area by defect class, each cell defect, clear (with evidence) or not
   examined.
3. A release gate: no open S1; no open S2 in a researcher-facing result, persistence or tenant
   boundary; every S3 either fixed or accepted by Grant in writing; full library and native
   suites passing on the frozen head.
4. A short verdict: ready, ready with listed conditions, or not ready, with the reasons.
5. What this audit cannot establish and who can: legal review (terms, privacy, POPIA, GDPR), an
   independent penetration test, live-model answer quality on real projects, load testing on the
   real hosting, and a restore drill.

Publish the report as `docs/independent-release-readiness-audit-main-<date>.md`, with the
evidence under `work/release-readiness-audit-<date>/`, and update the status line to
READY_FOR_CLAUDE with the counts by severity. Deliver Part 1 first if the full audit cannot finish
in one pass, and mark which parts remain.
