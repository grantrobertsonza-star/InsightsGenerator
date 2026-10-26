import { describe, expect, it, vi } from "vitest";
// Overnight queue, "repair the Objectives test harness": this file's own tests never call
// withTenant/withTenantRepeatableRead (they pass a fake client directly into
// publishGeneratedQuestions/loadObjectiveEvidenceAndCoverage, as the comment below already
// explains), but objectiveEvidence.ts imports ./crosstabs, which imports ./parseStatsFile,
// which constructs the real supabaseAdmin client eagerly at module load
// (createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, ...)) - this project has no
// vitest.config.ts or env-loading mechanism supplying those vars during a bare `vitest run`,
// so the whole file previously failed to even collect with "Error: supabaseUrl is required".
// Mocking the module avoids ever constructing the real client, the same pattern already used
// in contradictionDetector.test.ts (../db) and sheetSelectionConsistency.test.ts
// (../supabaseAdmin) for the identical root cause. ../anthropic/../apiUsage are mocked too
// since objectiveEvidence.ts imports them directly, even though neither is exercised by a test
// here - consistent with how contradictionDetector.test.ts already stubs the same two modules
// for a file that never calls them either.
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: { storage: { from: vi.fn() } } }));
vi.mock("../anthropic", () => ({ anthropic: {}, CLAUDE_MODEL: "test-model" }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));

import { loadObjectiveEvidenceAndCoverage, publishGeneratedQuestions } from "../objectiveEvidence";

// OBJ-REV-009 (third pass): controlled tests against the REAL publishGeneratedQuestions
// function (the actual entry point generateEvidenceQuestions calls, inside its one withTenant
// transaction), using an in-memory fake standing in for Postgres - the same dependency-
// injected-client shape contradictionDetector.test.ts already uses for this exact reason
// (downgradeContradictedOriginal takes `client` directly rather than calling withTenant
// itself).
//
// IMPORTANT - what this file does and does not prove: it is a CONTROLLED test, not a real
// PostgreSQL verification. The fake client below honestly simulates a transaction's
// commit/rollback contract (a working copy of the in-memory tables is only merged into the
// "committed" store if the call under test resolves; a thrown error discards the working copy
// entirely, exactly as withTenant's real `catch { rollback }` would), and it exercises the
// genuine SQL-sequencing logic inside publishGeneratedQuestions - the lock-first ordering, the
// demote-then-promote generation bookkeeping, and the delete/insert replacement. What it
// cannot prove is that a REAL Postgres `select ... for update` on the runs row actually blocks
// a second, truly concurrent transaction the way this sandbox has no live database to confirm
// (the same caveat storeResult's own doc comment states for OBJ-REV-007's row lock, a few
// hundred lines above in objectiveEvidence.ts) - that remains a real-database integration
// check, listed separately at the end of this file's own describe blocks.

type GenRow = {
  id: string;
  tenant_id: string;
  run_id: string;
  variables_truncated: boolean;
  pooled_count: number;
  used_count: number;
  is_current: boolean;
};

type EvidenceRow = {
  id: string;
  tenant_id: string;
  run_id: string;
  document_id: string | null;
  item_kind: "objective" | "decision";
  item_order: number;
  objective_candidate_id: string | null;
  decision_candidate_id: string | null;
  item_text: string;
  question: string;
  request_text: string;
  supports_if: string;
  against_if: string;
  expectation: string | null;
  source: "auto" | "edited" | "manual";
  excluded: boolean;
  generation_id: string | null;
  // OBJ-REV-001/002 Rule B (0095): recorded by every publication insert; absent on seeded fixtures.
  origin_candidate_id?: string | null;
  origin_recorded?: boolean;
};

type RunRow = { id: string; tenant_id: string };

type Store = { runs: RunRow[]; generations: GenRow[]; evidence: EvidenceRow[] };

function cloneStore(store: Store): Store {
  return {
    runs: store.runs.map((r) => ({ ...r })),
    generations: store.generations.map((g) => ({ ...g })),
    evidence: store.evidence.map((e) => ({ ...e })),
  };
}

// Every existing test publishes against this one run unless it explicitly overrides `runs` (the
// missing-run and foreign-tenant-run tests below do exactly that), so this default means no
// pre-existing test needed to start seeding a runs table once the lock query started checking one.
const DEFAULT_RUN: RunRow = { id: "run-1", tenant_id: "tenant-1" };

/** A fresh, committed in-memory database for one test. */
function freshDb(seed: Partial<Store> = {}): Store {
  return { runs: seed.runs ?? [DEFAULT_RUN], generations: seed.generations ?? [], evidence: seed.evidence ?? [] };
}

type Call = { sql: string; params: unknown[] };

// A single counter shared by every runAsOneTransaction call in this test file (not reset per
// call), so two successive publishes for the same run - as "overlapping generations" below
// deliberately does - never generate colliding row ids the way two independent per-call
// counters would. Real Postgres ids (gen_random_uuid()) are unique across transactions for
// the same reason; a fake id generator has to earn that property explicitly.
let sharedIdCounter = 1;

/**
 * Runs `fn` against a fake client bound to a WORKING COPY of `db`, mirroring withTenant's real
 * begin/commit/rollback contract (db.ts): the working copy is only merged back into `db` (the
 * "committed" state) if `fn` resolves; if it throws, the working copy is discarded and `db` is
 * left exactly as it was before this call, same as a real Postgres ROLLBACK. `failOn`, when
 * given, makes a specific query throw (matched by a substring of the SQL) so a test can inject
 * a failure partway through the real function's sequence of statements and observe the
 * resulting (non-)committed state.
 */
async function runAsOneTransaction<T>(
  db: Store,
  fn: (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, calls: Call[]) => Promise<T>,
  opts: { failOn?: string } = {},
): Promise<T> {
  const working = cloneStore(db);
  const calls: Call[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (opts.failOn && sql.includes(opts.failOn)) throw new Error(`simulated failure: ${opts.failOn}`);
      // OBJ-REV-001/002 Rule B: publication checks that migration 0095's origin columns exist
      // before any write. These fixtures model a migrated database.
      if (sql.includes("from information_schema.columns")) return { rows: [{ n: 2 }] };
      if (sql.includes("select id from runs where id = $1 and tenant_id = $2 for update")) {
        const [runId, tenantId] = params as [string, string];
        const match = working.runs.find((r) => r.id === runId && r.tenant_id === tenantId);
        return { rows: match ? [{ id: match.id }] : [] };
      }
      if (sql.includes("update objective_evidence_generations set is_current = false")) {
        const runId = params[0];
        for (const g of working.generations) if (g.run_id === runId && g.is_current) g.is_current = false;
        return { rows: [] };
      }
      if (sql.includes("insert into objective_evidence_generations")) {
        const [tenantId, runId, variablesTruncated, pooledCount, usedCount] = params as [string, string, boolean, number, number];
        const row: GenRow = {
          id: `gen-${sharedIdCounter++}`,
          tenant_id: tenantId,
          run_id: runId,
          variables_truncated: variablesTruncated,
          pooled_count: pooledCount,
          used_count: usedCount,
          is_current: true,
        };
        working.generations.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (sql.includes("delete from objective_evidence where run_id = $1 and source = 'auto' and excluded = false")) {
        const runId = params[0];
        working.evidence = working.evidence.filter((e) => !(e.run_id === runId && e.source === "auto" && !e.excluded));
        return { rows: [] };
      }
      if (sql.includes("insert into objective_evidence (")) {
        const [
          tenantId,
          runId,
          documentId,
          itemKind,
          itemOrder,
          objectiveCandidateId,
          decisionCandidateId,
          itemText,
          question,
          requestText,
          supportsIf,
          againstIf,
          expectation,
          generationId,
          originCandidateId,
          originRecorded,
        ] = params as [string, string, string | null, "objective" | "decision", number, string | null, string | null, string, string, string, string, string, string | null, string | null, string | null, boolean];
        working.evidence.push({
          id: `ev-${sharedIdCounter++}`,
          tenant_id: tenantId,
          run_id: runId,
          document_id: documentId,
          item_kind: itemKind,
          item_order: itemOrder,
          objective_candidate_id: objectiveCandidateId,
          decision_candidate_id: decisionCandidateId,
          item_text: itemText,
          question,
          request_text: requestText,
          supports_if: supportsIf,
          against_if: againstIf,
          expectation,
          source: "auto",
          excluded: false,
          generation_id: generationId,
          origin_candidate_id: originCandidateId,
          origin_recorded: originRecorded,
        });
        return { rows: [] };
      }
      throw new Error(`unhandled query in fake client: ${sql}`);
    },
  };
  const result = await fn(client, calls);
  // Only reached if fn did not throw - mirrors withTenant's `commit()` after a successful
  // callback. A thrown error propagates past this line, so `db` is never mutated at all.
  db.generations = working.generations;
  db.evidence = working.evidence;
  return result;
}

const draftedOf = (questions: string[]) => [
  {
    item: { kind: "objective" as const, order: 0, text: "Grow digital adoption", candidateId: null },
    qs: questions.map((q) => ({ question: q, request: `${q} by segment`, supports_if: "higher", against_if: "lower", expectation: null })),
  },
];

describe("publishGeneratedQuestions", () => {
  it("publishes a first-ever generation for a run with no prior generation or questions (initially empty)", async () => {
    const db = freshDb();
    const { generationId, created } = await runAsOneTransaction(db, (client, calls) =>
      publishGeneratedQuestions(client as never, {
        tenantId: "tenant-1",
        runId: "run-1",
        drafted: draftedOf(["Do women adopt mobile banking more than men?"]),
        variablesTruncated: false,
        pooledCount: 40,
        usedCount: 40,
      }).then((r) => {
        // Serialization is unconditional: the lock on the run row is taken even though this
        // run has never published a generation before and has no existing questions.
        expect(calls[0].sql).toContain("select id from runs where id = $1 and tenant_id = $2 for update");
        return r;
      }),
    );
    expect(created).toBe(1);
    expect(db.generations).toHaveLength(1);
    expect(db.generations[0].id).toBe(generationId);
    expect(db.generations[0].is_current).toBe(true);
    expect(db.evidence).toHaveLength(1);
    expect(db.evidence[0].generation_id).toBe(generationId);
  });

  it("replaces an existing question set and demotes the prior current generation (existing question set)", async () => {
    const db = freshDb({
      generations: [
        { id: "gen-old", tenant_id: "tenant-1", run_id: "run-1", variables_truncated: true, pooled_count: 165, used_count: 160, is_current: true },
      ],
      evidence: [
        {
          id: "ev-old", tenant_id: "tenant-1", run_id: "run-1", document_id: null, item_kind: "objective", item_order: 0,
          objective_candidate_id: null, decision_candidate_id: null, item_text: "Grow digital adoption",
          question: "Old question", request_text: "old request", supports_if: "x", against_if: "y", expectation: null,
          source: "auto", excluded: false, generation_id: "gen-old",
        },
      ],
    });
    const { generationId } = await runAsOneTransaction(db, (client) =>
      publishGeneratedQuestions(client as never, {
        tenantId: "tenant-1",
        runId: "run-1",
        drafted: draftedOf(["New question"]),
        variablesTruncated: false,
        pooledCount: 50,
        usedCount: 50,
      }),
    );
    expect(generationId).not.toBe("gen-old");
    const old = db.generations.find((g) => g.id === "gen-old")!;
    expect(old.is_current).toBe(false); // demoted, not deleted - its history survives
    const fresh = db.generations.find((g) => g.id === generationId)!;
    expect(fresh.is_current).toBe(true);
    expect(fresh.variables_truncated).toBe(false);
    expect(db.evidence).toHaveLength(1);
    expect(db.evidence[0].question).toBe("New question");
    expect(db.evidence[0].generation_id).toBe(generationId);
  });

  it("an edited/manual row (source <> 'auto') is never removed by a new generation's replacement sweep", async () => {
    const db = freshDb({
      evidence: [
        {
          id: "ev-manual", tenant_id: "tenant-1", run_id: "run-1", document_id: null, item_kind: "objective", item_order: 0,
          objective_candidate_id: null, decision_candidate_id: null, item_text: "Grow digital adoption",
          question: "A researcher-added question", request_text: "req", supports_if: "x", against_if: "y", expectation: null,
          source: "manual", excluded: false, generation_id: null,
        },
      ],
    });
    await runAsOneTransaction(db, (client) =>
      publishGeneratedQuestions(client as never, {
        tenantId: "tenant-1",
        runId: "run-1",
        drafted: draftedOf(["New question"]),
        variablesTruncated: false,
        pooledCount: 10,
        usedCount: 10,
      }),
    );
    expect(db.evidence.some((e) => e.id === "ev-manual")).toBe(true);
    expect(db.evidence).toHaveLength(2);
  });

  // OBJ-REV-009 (fourth pass): this test was previously titled "overlapping generations ...
  // reversed completion order", which claimed more than a controlled, sequential test can show.
  // Nothing here runs concurrently: "generation A" publishes and fully commits (via
  // runAsOneTransaction) before "generation B" starts, one `await` after another. What this
  // proves is sequential replacement - a second completed publish for the same run supersedes
  // the first's generation and questions - not that two overlapping or reordered publications
  // were exercised. Whether Postgres's `for update` lock genuinely serializes two truly
  // concurrent sessions, so that a slower-drafting "A" can never commit after a faster "B" and
  // clobber it, is exactly the kind of claim only a real two-session PostgreSQL integration test
  // can support - it is listed as outstanding at the end of this file, not demonstrated here.
  it("sequential replacement: a second completed publish for the same run supersedes the first's generation and questions", async () => {
    const db = freshDb();
    // Generation A: imagine its drafting (decompose/model calls) STARTED first but ran slow.
    const a = await runAsOneTransaction(db, (client) =>
      publishGeneratedQuestions(client as never, {
        tenantId: "tenant-1",
        runId: "run-1",
        drafted: draftedOf(["Question from slow generation A"]),
        variablesTruncated: true,
        pooledCount: 200,
        usedCount: 160,
      }),
    );
    // Generation B: imagine it started AFTER A but finished drafting faster, so its publish
    // call is the one that actually runs (= commits) second/last.
    const b = await runAsOneTransaction(db, (client) =>
      publishGeneratedQuestions(client as never, {
        tenantId: "tenant-1",
        runId: "run-1",
        drafted: draftedOf(["Question from fast generation B"]),
        variablesTruncated: false,
        pooledCount: 30,
        usedCount: 30,
      }),
    );
    expect(db.generations.find((g) => g.id === a.generationId)!.is_current).toBe(false);
    expect(db.generations.find((g) => g.id === b.generationId)!.is_current).toBe(true);
    // The question set actually in effect is B's, not A's - A's question was replaced, not
    // left stranded alongside B's.
    expect(db.evidence).toHaveLength(1);
    expect(db.evidence[0].question).toBe("Question from fast generation B");
    expect(db.evidence[0].generation_id).toBe(b.generationId);
  });

  it("replacement failure: a question-insert failure leaves the prior generation and prior questions fully intact", async () => {
    const db = freshDb({
      generations: [
        { id: "gen-old", tenant_id: "tenant-1", run_id: "run-1", variables_truncated: false, pooled_count: 20, used_count: 20, is_current: true },
      ],
      evidence: [
        {
          id: "ev-old", tenant_id: "tenant-1", run_id: "run-1", document_id: null, item_kind: "objective", item_order: 0,
          objective_candidate_id: null, decision_candidate_id: null, item_text: "Grow digital adoption",
          question: "Old question", request_text: "old request", supports_if: "x", against_if: "y", expectation: null,
          source: "auto", excluded: false, generation_id: "gen-old",
        },
      ],
    });
    const before = cloneStore(db);
    await expect(
      runAsOneTransaction(
        db,
        (client) =>
          publishGeneratedQuestions(client as never, {
            tenantId: "tenant-1",
            runId: "run-1",
            drafted: draftedOf(["New question that will fail to insert"]),
            variablesTruncated: false,
            pooledCount: 10,
            usedCount: 10,
          }),
        { failOn: "insert into objective_evidence (" },
      ),
    ).rejects.toThrow(/simulated failure/);
    // Nothing committed: same generation still current, same old question still in place -
    // not a partially-applied delete with no replacement, and not a promoted-but-empty
    // generation either.
    expect(db).toEqual(before);
  });

  it("coverage-write failure: a failure writing the new generation row leaves the prior generation and prior questions fully intact", async () => {
    const db = freshDb({
      generations: [
        { id: "gen-old", tenant_id: "tenant-1", run_id: "run-1", variables_truncated: true, pooled_count: 170, used_count: 160, is_current: true },
      ],
      evidence: [
        {
          id: "ev-old", tenant_id: "tenant-1", run_id: "run-1", document_id: null, item_kind: "objective", item_order: 0,
          objective_candidate_id: null, decision_candidate_id: null, item_text: "Grow digital adoption",
          question: "Old question", request_text: "old request", supports_if: "x", against_if: "y", expectation: null,
          source: "auto", excluded: false, generation_id: "gen-old",
        },
      ],
    });
    const before = cloneStore(db);
    await expect(
      runAsOneTransaction(
        db,
        (client) =>
          publishGeneratedQuestions(client as never, {
            tenantId: "tenant-1",
            runId: "run-1",
            drafted: draftedOf(["New question"]),
            variablesTruncated: false,
            pooledCount: 5,
            usedCount: 5,
          }),
        { failOn: "insert into objective_evidence_generations" },
      ),
    ).rejects.toThrow(/simulated failure/);
    // Before this pass, a coverage-write failure could leave NEW (possibly truncated)
    // questions in effect under the OLD warning - a decoupled, inconsistent state. Now a
    // failure this early aborts before the delete/insert of questions ever runs at all, and
    // the one shared transaction means none of it is committed either way.
    expect(db).toEqual(before);
    expect(db.generations[0].is_current).toBe(true); // never demoted, because nothing committed
    expect(db.evidence[0].question).toBe("Old question"); // never replaced
  });

  // OBJ-REV-009 (fourth pass): the run-ownership lock query used to ignore its own result
  // entirely, so a missing or foreign-tenant run id was silently accepted - nothing re-derived
  // tenant/run from the lock query, every write just trusted the caller-supplied parameters. The
  // two tests below exercise the real function against a run table that does NOT contain a
  // matching row, and confirm it throws before any write, leaving the store completely
  // untouched (not a partial write, not a generation created for a run that was never real).
  it("missing run: a run id that does not exist produces zero writes", async () => {
    const db = freshDb({ runs: [] });
    const before = cloneStore(db);
    await expect(
      runAsOneTransaction(db, (client) =>
        publishGeneratedQuestions(client as never, {
          tenantId: "tenant-1",
          runId: "run-1",
          drafted: draftedOf(["Should never be written"]),
          variablesTruncated: false,
          pooledCount: 10,
          usedCount: 10,
        }),
      ),
    ).rejects.toThrow(/not found for this tenant/);
    expect(db).toEqual(before);
    expect(db.generations).toHaveLength(0);
    expect(db.evidence).toHaveLength(0);
  });

  it("foreign-tenant run: a run id that exists but belongs to a different tenant produces zero writes", async () => {
    const db = freshDb({ runs: [{ id: "run-1", tenant_id: "tenant-OTHER" }] });
    const before = cloneStore(db);
    await expect(
      runAsOneTransaction(db, (client) =>
        publishGeneratedQuestions(client as never, {
          tenantId: "tenant-1",
          runId: "run-1",
          drafted: draftedOf(["Should never be written"]),
          variablesTruncated: false,
          pooledCount: 10,
          usedCount: 10,
        }),
      ),
    ).rejects.toThrow(/not found for this tenant/);
    expect(db).toEqual(before);
    expect(db.generations).toHaveLength(0);
    expect(db.evidence).toHaveLength(0);
  });
});

// OBJ-REV-009 (fourth pass): controlled tests against the REAL loadObjectiveEvidenceAndCoverage
// function - the client-parameterized core loadObjectiveEvidenceWithCoverage wraps in a real
// withTenantRepeatableRead() transaction. Requirement 2 (absent coverage must read as unknown,
// never as a recorded false) and requirement 3 (questions and coverage must come from one
// consistent generation even if a publish commits in between) both land on this one function,
// so both get exercised here, against the actual code, not a description of it.
type CoverageEvidenceRow = {
  id: string;
  item_kind: "objective" | "decision";
  item_order: number;
  objective_candidate_id: string | null;
  decision_candidate_id: string | null;
  item_text: string;
  question: string;
  request_text: string;
  supports_if: string;
  against_if: string;
  expectation: string | null;
  source: "auto" | "edited" | "manual";
  excluded: boolean;
  question_revision: number;
};

type CoverageResultRow = {
  evidence_id: string;
  document_id: string;
  dataset_name: string;
  table_id: string | null;
  stance: string | null;
  basis: string | null;
  estimate: unknown;
  summary: string | null;
  error: string | null;
  evaluated_at: string | null;
};

type CoverageStore = {
  generations: { run_id: string; is_current: boolean; variables_truncated: boolean }[];
  evidence: CoverageEvidenceRow[];
  results: CoverageResultRow[];
};

/**
 * Runs the real loadObjectiveEvidenceAndCoverage against a fake client bound to a WORKING COPY
 * of `store`, cloned once at this call's start - mirroring the one-snapshot guarantee
 * withTenantRepeatableRead's REPEATABLE READ transaction is relied on to provide (db.ts's own
 * doc comment on that function). Every query this call issues reads only from that frozen
 * copy, never from `store` itself, so a test can mutate `store` mid-call (via `onCoverageRead`,
 * fired right after the coverage query resolves but before the questions query runs) to
 * simulate a second session's publish committing in between the two reads, and then confirm
 * the questions read still sees the pre-mutation snapshot.
 *
 * What this proves: given a transaction that genuinely holds one snapshot for all of its
 * statements, this function's own sequencing cannot produce a response mixing one generation's
 * questions with a different generation's coverage verdict. What it does NOT prove: that a
 * real PostgreSQL REPEATABLE READ transaction actually holds that snapshot under a truly
 * concurrent second session - that remains a real-database integration check, listed
 * separately at the end of this file.
 */
function runLoad(
  store: CoverageStore,
  runId: string,
  opts: { onCoverageRead?: (liveStore: CoverageStore) => void } = {},
) {
  const working: CoverageStore = {
    generations: store.generations.map((g) => ({ ...g })),
    evidence: store.evidence.map((e) => ({ ...e })),
    results: store.results.map((r) => ({ ...r })),
  };
  const client = {
    query: async (sql: string, _params: unknown[] = []) => {
      if (sql.includes("savepoint")) return { rows: [] };
      // OBJ-REV-001/002 Rule B: the loader also reads the current objectives/decisions on this same
      // client. These fixtures have none, so every question is classified without a current owner;
      // the assertions below are about coverage and snapshot consistency, which that does not touch.
      if (sql.includes("select research_objective, decision_statement from runs where id = $1")) {
        return { rows: [{ research_objective: null, decision_statement: null }] };
      }
      if (sql.includes("from objective_candidates where run_id = $1") || sql.includes("from decision_candidates where run_id = $1")) {
        return { rows: [] };
      }
      if (sql.includes("from documents where run_id = $1")) return { rows: [] };
      if (sql.startsWith("select id from objective_evidence where run_id = $1 and excluded = false")) return { rows: working.evidence.filter(e => !e.excluded).map(e => ({id:e.id})) };
      if (sql.startsWith("select evidence_id, document_id, had_table, table_id from objective_evidence_results")) return { rows: working.results };
      if (sql.includes("from objective_evidence_generations")) {
        const row = working.generations.find((g) => g.run_id === runId && g.is_current);
        const rows = row ? [{ variables_truncated: row.variables_truncated }] : [];
        // Fires after this query's own (snapshotted) result is already computed, simulating a
        // publish that commits right after this transaction's coverage read - the working copy
        // was already cloned above, so it cannot see what this mutates.
        if (opts.onCoverageRead) opts.onCoverageRead(store);
        return { rows };
      }
      if (sql.includes("from objective_evidence where run_id = $1 order by item_kind desc")) {
        return { rows: working.evidence };
      }
      if (sql.includes("from objective_evidence_results where run_id = $1 order by dataset_name")) {
        return { rows: working.results };
      }
      throw new Error(`unhandled query in fake client: ${sql}`);
    },
  };
  return loadObjectiveEvidenceAndCoverage(client as never, runId);
}

describe("loadObjectiveEvidenceAndCoverage", () => {
  it("absent coverage returns unknown (null), not false, when no current generation exists", async () => {
    const store: CoverageStore = {
      generations: [],
      evidence: [
        {
          id: "ev-legacy",
          item_kind: "objective",
          item_order: 0,
          objective_candidate_id: null,
          decision_candidate_id: null,
          item_text: "Grow digital adoption",
          question: "Legacy question predating migration 0092",
          request_text: "req",
          supports_if: "x",
          against_if: "y",
          expectation: null,
          source: "auto",
          excluded: false,
          question_revision: 0,
        },
      ],
      results: [],
    };
    const { questions, variablesTruncated } = await runLoad(store, "run-1");
    expect(variablesTruncated).toBeNull();
    expect(questions).toHaveLength(1);
    expect(questions[0].question).toBe("Legacy question predating migration 0092");
  });

  it("a recorded false verdict is returned as false, never folded into the same null that absent coverage returns", async () => {
    const store: CoverageStore = {
      generations: [{ run_id: "run-1", is_current: true, variables_truncated: false }],
      evidence: [],
      results: [],
    };
    const { variablesTruncated } = await runLoad(store, "run-1");
    expect(variablesTruncated).toBe(false);
  });

  it("publication interleaved with loading: a generation that becomes current between the coverage read and the questions read cannot split this call's result", async () => {
    const store: CoverageStore = {
      generations: [], // no current generation yet when this call's coverage read actually runs
      evidence: [
        {
          id: "ev-old",
          item_kind: "objective",
          item_order: 0,
          objective_candidate_id: null,
          decision_candidate_id: null,
          item_text: "Grow digital adoption",
          question: "Old question (pre-publish snapshot)",
          request_text: "req",
          supports_if: "x",
          against_if: "y",
          expectation: null,
          source: "auto",
          excluded: false,
          question_revision: 0,
        },
      ],
      results: [],
    };
    let coverageReadCount = 0;
    const result = await runLoad(store, "run-1", {
      onCoverageRead: (liveStore) => {
        coverageReadCount += 1;
        // Simulate a concurrent publish committing right between this call's two reads: a
        // brand-new current generation, and a brand-new question replacing the old one -
        // exactly the shape of a real publishGeneratedQuestions commit landing mid-load.
        liveStore.generations = [{ run_id: "run-1", is_current: true, variables_truncated: true }];
        liveStore.evidence = [
          {
            id: "ev-new",
            item_kind: "objective",
            item_order: 0,
            objective_candidate_id: null,
            decision_candidate_id: null,
            item_text: "Grow digital adoption",
            question: "New question from concurrent publish",
            request_text: "req",
            supports_if: "x",
            against_if: "y",
            expectation: null,
            source: "auto",
            excluded: false,
            question_revision: 0,
          },
        ];
      },
    });
    expect(coverageReadCount).toBe(1);
    // The coverage read ran before the simulated publish committed, so it correctly saw "no
    // current generation yet" - null, not the new generation's `true`.
    expect(result.variablesTruncated).toBeNull();
    // The questions read runs AFTER the simulated publish committed in real wall-clock time,
    // but inside this one transaction's held snapshot it must still see what the coverage read
    // saw - the old question, not the new one. Seeing the new question here would mean this
    // call mixed one generation's coverage with a different generation's questions, exactly
    // the bug this function exists to close.
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].question).toBe("Old question (pre-publish snapshot)");
  });
});
