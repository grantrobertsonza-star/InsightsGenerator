// OBJ-REV-001/002 Rule B test harness: an in-memory stand-in for the Postgres boundary only, wired
// in by mocking `pg`, so the REAL db.ts withTenant / withTenantRepeatableRead and the REAL
// objectiveEvidence.ts SQL run against it. It answers exactly the statements the Objectives
// evidence lane sends and throws on anything else.
//
// Transactions: each connection's `begin` takes a private working copy of the committed store and
// every statement in that transaction reads and writes only the copy (this models both rollback and
// a REPEATABLE READ snapshot); `commit` publishes the copy, `rollback` discards it. `origin: false`
// models a database without migration 0095: any statement naming origin_candidate_id or
// origin_recorded fails with PostgreSQL's undefined-column wording, and the catalogue check reports
// the columns absent. Savepoints are recorded, not modelled (a failed statement does not poison the
// fake's transaction), so tests assert the rollback-to-savepoint ordering explicitly.
//
// Not real PostgreSQL: locking, isolation under true concurrency and constraint enforcement are
// separate integration checks.

export type Row = Record<string, unknown>;

export type ObjStore = {
  runs: Row[];
  objective_candidates: Row[];
  decision_candidates: Row[];
  documents: Row[];
  evidence: Row[];
  results: Row[];
  generations: Row[];
};

type Fault = { match: RegExp; error: string; nth?: number; seen?: number };
type Hook = { match: RegExp; fn: (live: ObjStore) => void; fired?: boolean };

export function createFakeObjectiveDb(initial: Partial<ObjStore> = {}, options: { origin?: boolean } = {}) {
  let origin = options.origin ?? true;
  const store: ObjStore = {
    runs: [],
    objective_candidates: [],
    decision_candidates: [],
    documents: [],
    evidence: [],
    results: [],
    generations: [],
    ...structuredClone(initial),
  };
  const faults: Fault[] = [];
  const hooks: Hook[] = [];
  const log: { conn: number; sql: string; params: unknown[] }[] = [];
  let connections = 0;
  let releases = 0;
  let seq = 1;

  function connect() {
    const conn = ++connections;
    let working: ObjStore | null = null;
    const view = () => working ?? store;

    async function query(sql: string, params: unknown[] = []) {
      const s = sql.replace(/\s+/g, " ").trim().toLowerCase();
      log.push({ conn, sql: s, params });
      for (const f of faults) {
        if (f.match.test(s)) {
          f.seen = (f.seen ?? 0) + 1;
          if (f.nth === undefined || f.seen === f.nth) throw new Error(f.error);
        }
      }
      if (s.startsWith("begin")) {
        working = structuredClone(store);
        return { rows: [] };
      }
      if (s === "commit") {
        if (working) Object.assign(store, working);
        working = null;
        return { rows: [] };
      }
      if (s === "rollback") {
        working = null;
        return { rows: [] };
      }
      if (/^(savepoint|release savepoint|rollback to savepoint|select set_config)/.test(s)) return { rows: [] };
      if (s.includes("from information_schema.columns")) return { rows: [{ n: origin ? 2 : 0 }] };
      if (!origin && /origin_candidate_id|origin_recorded/.test(s)) {
        const col = /origin_candidate_id/.test(s) ? "origin_candidate_id" : "origin_recorded";
        throw new Error(`column "${col}" does not exist`);
      }
      const db = view();
      const after = (rows: Row[]) => {
        for (const h of hooks) if (!h.fired && h.match.test(s)) {
          h.fired = true;
          h.fn(store);
        }
        return { rows, rowCount: rows.length };
      };

      if (s === "select research_objective, decision_statement from runs where id = $1") {
        return after(db.runs.filter((r) => r.id === params[0]).map((r) => ({ research_objective: r.research_objective ?? null, decision_statement: r.decision_statement ?? null })));
      }
      for (const table of ["objective_candidates", "decision_candidates"] as const) {
        if (s === `select id, candidate_text, source from ${table} where run_id = $1 and status = 'accepted' order by created_at`) {
          return after(
            db[table]
              .filter((c) => c.run_id === params[0] && c.status === "accepted")
              .sort((a, b) => (a.created_seq as number) - (b.created_seq as number))
              .map((c) => ({ id: c.id, candidate_text: c.candidate_text, source: c.source })),
          );
        }
      }
      if (s === "select id from runs where id = $1 and tenant_id = $2 for update") {
        return after(db.runs.filter((r) => r.id === params[0] && r.tenant_id === params[1]).map((r) => ({ id: r.id })));
      }
      if (s.startsWith("select id, source_filename, ingestion_type from documents where run_id = $1 and kind = 'table'")) {
        return after(db.documents.filter((d) => d.run_id === params[0] && d.kind === "table"));
      }
      if (s.startsWith("select id from objective_evidence where run_id = $1 and excluded = false")) {
        return after(db.evidence.filter(e => e.run_id === params[0] && !e.excluded).map(e => ({id:e.id})));
      }
      if (s.startsWith("select evidence_id, document_id, had_table, table_id from objective_evidence_results") || s.startsWith("select evidence_id, document_id, table_id from objective_evidence_results")) {
        return after(db.results.filter(r => r.run_id === params[0]));
      }
      if (s.startsWith("select id, item_kind, item_order, item_text, objective_candidate_id, decision_candidate_id, origin_candidate_id, origin_recorded from objective_evidence where run_id = $1 and (source <> 'auto' or excluded = true)")) {
        return after(db.evidence.filter((e) => e.run_id === params[0] && (e.source !== "auto" || e.excluded === true)));
      }
      if (s.startsWith("select id, item_kind, item_order, objective_candidate_id") && s.includes("from objective_evidence where run_id = $1 order by")) {
        const withOrigin = s.includes("origin_candidate_id");
        const rows = db.evidence
          .filter((e) => e.run_id === params[0])
          .sort((a, b) =>
            a.item_kind !== b.item_kind ? (a.item_kind === "objective" ? -1 : 1) : (a.item_order as number) - (b.item_order as number) || (a.created_seq as number) - (b.created_seq as number),
          )
          .map((e) => {
            const out: Row = { ...e };
            delete out.created_seq;
            if (!withOrigin) {
              delete out.origin_candidate_id;
              delete out.origin_recorded;
            }
            return out;
          });
        return after(rows);
      }
      if (s.includes("from objective_evidence_results where run_id = $1 order by dataset_name")) {
        return after(db.results.filter((r) => r.run_id === params[0]));
      }
      if (s.startsWith("select variables_truncated from objective_evidence_generations where run_id = $1 and is_current = true")) {
        return after(db.generations.filter((g) => g.run_id === params[0] && g.is_current).map((g) => ({ variables_truncated: g.variables_truncated })));
      }
      if (s.startsWith("update objective_evidence_generations set is_current = false")) {
        for (const g of db.generations) if (g.run_id === params[0] && g.is_current) g.is_current = false;
        return { rows: [] };
      }
      if (s.startsWith("insert into objective_evidence_generations")) {
        const row = { id: `gen-${seq++}`, tenant_id: params[0], run_id: params[1], variables_truncated: params[2], pooled_count: params[3], used_count: params[4], is_current: true };
        db.generations.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (s === "delete from objective_evidence where run_id = $1 and source = 'auto' and excluded = false") {
        const gone = new Set(db.evidence.filter((e) => e.run_id === params[0] && e.source === "auto" && e.excluded === false).map((e) => e.id));
        db.evidence = db.evidence.filter((e) => !gone.has(e.id));
        db.results = db.results.filter((r) => !gone.has(r.evidence_id));
        return { rows: [] };
      }
      if (s.startsWith("insert into objective_evidence (")) {
        const cols = /insert into objective_evidence \(([^)]*)\)/.exec(s)![1].split(",").map((c) => c.trim());
        const row: Row = { id: `ev-new-${seq++}`, source: "auto", excluded: false, question_revision: 0, origin_candidate_id: null, origin_recorded: false, created_seq: seq++ };
        cols.forEach((c, i) => (row[c] = params[i]));
        db.evidence.push(row);
        return { rows: [] };
      }
      if (s === "select question, request_text, supports_if, against_if from objective_evidence where id = $1 and run_id = $2 for update") {
        return after(db.evidence.filter((e) => e.id === params[0] && e.run_id === params[1]));
      }
      if (s.startsWith("update objective_evidence set question = coalesce($3, question)")) {
        const [id, runId, q, rt, si, ai, excluded, changed] = params as [string, string, string | null, string | null, string | null, string | null, boolean | null, boolean];
        for (const e of db.evidence.filter((x) => x.id === id && x.run_id === runId)) {
          if (q !== null) e.question = q;
          if (rt !== null) e.request_text = rt;
          if (si !== null) e.supports_if = si;
          if (ai !== null) e.against_if = ai;
          if (excluded !== null) e.excluded = excluded;
          if (changed) {
            e.source = "edited";
            e.expectation = null;
            e.generation_id = null;
            e.question_revision = (e.question_revision as number) + 1;
          }
        }
        return { rows: [] };
      }
      if (s === "delete from objective_evidence_results where evidence_id = $1 and run_id = $2") {
        db.results = db.results.filter((r) => !(r.evidence_id === params[0] && r.run_id === params[1]));
        return { rows: [] };
      }
      throw new Error(`unhandled fake-objective-db query: ${sql}`);
    }

    return { query, release: () => void releases++ };
  }

  return {
    store,
    log,
    connect,
    get connections() {
      return connections;
    },
    get releases() {
      return releases;
    },
    setOrigin(value: boolean) {
      origin = value;
    },
    failOn(match: RegExp, error: string, nth?: number) {
      faults.push({ match, error, nth });
    },
    afterRead(match: RegExp, fn: (live: ObjStore) => void) {
      hooks.push({ match, fn });
    },
  };
}

export type FakeObjectiveDb = ReturnType<typeof createFakeObjectiveDb>;
