<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


<!-- BEGIN:insightsapp-coding-standard -->

# InsightsApp coding standard

Agreed with the project owner 2026-10-13. Applies to every change to this app, on top of
anything the Next.js block above requires. Claude implements against these; Codex (or any
other independent reviewer) assesses adherence to them, read-only, in addition to functional
defects.

1. **Structure.** UI (`src/app/**/*.tsx`), business rules (`src/lib/*.ts`), and statistical
   calculations (`api/parse-stats-file.py` and the scripts that call it) stay in their own
   layers. A component does not query the database or compute statistics directly - it calls
   into `src/lib`. A shared rule (a variable's canonical identity, a question's kind, a base
   definition) has exactly one authoritative implementation; check for an existing one before
   writing a parallel version.
2. **Data contracts.** TypeScript and Python agree on variable identity (canonical name vs.
   display label - see IMP-003), response codes, missing-value treatment, bases, weights, and
   sampling design. Requests are validated at the server-action boundary (enum values, variable
   existence, run/tenant ownership) rather than trusted from the client.
3. **Correctness.** A corrected defect gets a focused regression check covering its repro, a
   boundary case, and a failure-recovery case - an automated test where the harness reaches it,
   a documented manual verification where it doesn't (this codebase has no test runner wired up
   yet; `npx tsc --noEmit` and `python3 -c "import ast; ast.parse(...)"` catch type and syntax
   errors, not behaviour). A statistic with an independently knowable answer (survey-design SE,
   FDR correction, a weighted mean) is checked against a hand-computed or reference value at
   least once when it's introduced or changed.
4. **Reliability.** A failed operation surfaces an error the researcher can see and act on -
   never a silent substituted default that changes research meaning (assuming no weight, no
   design, or an empty override map on a lookup failure). Retries do not duplicate inserted
   rows. A concurrent save to the same record does not silently discard the losing write (see
   the compare-and-swap pattern in `saveDataSetup` and the ownership `for update` pattern in
   `saveVariableOverride`).
5. **Security.** Every mutation re-checks ownership (`run_id`/`tenant_id` scoping) on the write,
   not only on the read that preceded it. No credential or secret in client-bundled code;
   shared secrets (`PARSE_STATS_SHARED_SECRET` and the like) are read from `process.env` only,
   server-side, and never logged.
6. **Efficiency.** A performance-motivated change states the measurement that motivated it and
   the measurement taken afterward (timing, row/query counts, payload size) rather than being
   asserted from code shape alone, and it preserves the same correct result set.
7. **Maintainability.** Names describe what a thing represents, not its type or that it's a
   helper. A function has one job; split one whose responsibilities are easier to name apart
   than together. Dead code and superseded comments are removed in the same change that
   supersedes them, not left as a reminder of history.
8. **Documentation.** A comment earns its place by explaining a *why* the code doesn't already
   show: a research definition (what counts as the base, what "weighted" means here), an
   external constraint (a Vercel payload limit, a pyreadstat quirk), or why an edge case is
   handled the way it is - not what the next line obviously does. A comment is corrected in the
   same change that makes it wrong.

## Standing instruction to Claude

For every change to this app: follow the rules above; keep UI, business logic, persistence and
statistical processing separated; reuse authoritative shared rules instead of duplicating
parsing or research logic; validate inputs at system boundaries and preserve canonical
identities and research metadata; handle failures explicitly rather than silently substituting
a default that changes research meaning; add a focused regression check for every corrected
defect, including a relevant boundary and failure case; document non-obvious decisions and
statistical assumptions in code (explain why, not obvious syntax); update affected technical
documentation (the `claude/*.md` engineering briefs) when behaviour or contracts change; for a
performance change, give before-and-after measurements and confirm equivalent results; report
the checks actually run, their results, and remaining limitations - not quality claimed from
`tsc` passing alone. Keep changes focused, and call out unrelated refactoring separately rather
than folding it in.

## Standing instruction to an independent reviewer (e.g. Codex)

In addition to functional defects, assess each changed module against the standard above.
Remain read-only. Report specific violations with file references, their practical
consequences, and acceptance criteria for a fix. Separate correctness defects, maintainability
concerns, and measured performance problems into distinct findings. Do not infer inefficiency
merely from code length or style, and do not recommend an abstraction without naming the
specific duplication or maintenance problem it would solve. Check comments against the code
they describe, and flag a missing explanation wherever a research assumption or an unusual
behaviour could otherwise be misread. Sequence: correct technical defects first, then assess
maintainability and measured performance, then UI and missing functionality.

<!-- END:insightsapp-coding-standard -->
