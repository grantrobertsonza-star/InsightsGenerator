// REP-IN-002 test harness: an in-memory stand-in for the Postgres boundary only. It is wired in
// by mocking the `pg` module, so the REAL ../db withTenant (begin / commit / rollback), the REAL
// ../findingArchive SQL, the REAL ../findingActions researcher actions and the REAL
// ../findingProvenance writes run against it. It interprets just the statements those paths send
// and throws on anything else, so an unexpected query fails a test rather than silently passing.
//
// `provenance` models whether migration 0094 is applied. When it is not, any statement that names
// a 0094 column (other than the explicit pre-migration fallback literals) fails with "column does
// not exist", exactly as PostgreSQL would, so a pre-migration code path that wrongly depends on
// the new columns is caught.
//
// Modelled, not real PostgreSQL: transactions are per-connection undo logs (rollback reverses
// that connection's own writes); `for update` takes no lock; `delete from findings` applies the
// schema's cascades (verdicts, insights -> recommendations) and `on delete set null` for
// grounded_by_finding_id by hand; column defaults of 0094 are emulated on insert. Locking,
// isolation, the migration DDL itself and real constraint behaviour need the separately
// authorised disposable-database run.

export type Row = Record<string, unknown>;

export type FakeDbState = {
  documents: Row[];
  findings: Row[];
  verdicts: Row[];
  insights: Row[];
  recommendations: Row[];
  finding_history: Row[];
  verdict_history: Row[];
  insight_history: Row[];
  recommendation_history: Row[];
  trace: Row[];
};

export type FaultRule = { match: RegExp; nth: number; seen?: number };

const PROVENANCE_COLUMN = /human_reviewed_at|human_review_action|human_edited_at|human_edited_fields|provenance_tracked/;
const PRE_MIGRATION_FALLBACKS = [
  "null::timestamptz as human_reviewed_at",
  "'{}'::text[] as human_edited_fields",
  "false as provenance_tracked",
];

export function createFakeFindingsDb(initial: Partial<FakeDbState> = {}, options: { provenance?: boolean } = {}) {
  const provenance = options.provenance ?? true;
  const state: FakeDbState = {
    documents: [],
    findings: [],
    verdicts: [],
    insights: [],
    recommendations: [],
    finding_history: [],
    verdict_history: [],
    insight_history: [],
    recommendation_history: [],
    trace: [],
    ...structuredClone(initial),
  };
  const faults: FaultRule[] = [];
  let seq = 1000;
  let newIds = 0;
  const executed: string[] = [];

  function connect() {
    let undo: (() => void)[] | null = null;
    const record = (fn: () => void) => {
      if (undo) undo.push(fn);
    };
    const insertRow = (table: keyof FakeDbState, row: Row) => {
      state[table].push(row);
      record(() => {
        const i = state[table].indexOf(row);
        if (i >= 0) state[table].splice(i, 1);
      });
    };
    const deleteWhere = (table: keyof FakeDbState, pred: (r: Row) => boolean) => {
      const rows = state[table];
      for (let i = rows.length - 1; i >= 0; i--) {
        if (pred(rows[i])) {
          const [removed] = rows.splice(i, 1);
          const at = i;
          record(() => rows.splice(at, 0, removed));
        }
      }
    };
    const setField = (row: Row, key: string, value: unknown) => {
      const before = row[key];
      const had = key in row;
      row[key] = value;
      record(() => {
        if (had) row[key] = before;
        else delete row[key];
      });
    };
    const updateFindings = (ids: (r: Row) => boolean, key: string, value: unknown) => {
      const hit = state.findings.filter(ids);
      for (const f of hit) setField(f, key, value);
      return { rows: hit.map((f) => ({ id: f.id })), rowCount: hit.length };
    };

    async function query(sql: string, params: unknown[] = []) {
      const s = sql.replace(/\s+/g, " ").trim().toLowerCase();
      executed.push(s);
      for (const f of faults) {
        if (f.match.test(s)) {
          f.seen = (f.seen ?? 0) + 1;
          if (f.seen === f.nth) throw new Error(`injected failure on: ${f.match.source}`);
        }
      }
      if (!provenance && !s.includes("information_schema")) {
        let stripped = s;
        for (const lit of PRE_MIGRATION_FALLBACKS) stripped = stripped.split(lit).join("");
        if (PROVENANCE_COLUMN.test(stripped)) {
          throw new Error(`column does not exist (migration 0094 not applied): ${sql}`);
        }
      }
      if (s.startsWith("begin")) {
        undo = [];
        return { rows: [] };
      }
      if (s === "commit") {
        undo = null;
        return { rows: [] };
      }
      if (s === "rollback") {
        const u = undo ?? [];
        undo = null;
        for (let i = u.length - 1; i >= 0; i--) u[i]();
        return { rows: [] };
      }
      if (s.startsWith("select set_config")) return { rows: [] };
      // DI-F07: finding_history.researcher_note (migration 0114) is present in the migrated world.
      if (s.includes("from information_schema.columns") && s.includes("researcher_note")) {
        return { rows: [{ n: provenance ? 1 : 0 }] };
      }
      if (s.includes("from information_schema.columns")) {
        return { rows: [{ n: provenance ? 10 : 0 }] };
      }
      // DI-F07, before 0114: is any finding about to be retired carrying a note?
      if (s.startsWith("select 1 from findings where") && s.includes("btrim(researcher_note)")) {
        const ids = Array.isArray(params[0]) ? (params[0] as string[]) : null;
        const noted = state.findings.some(
          (f) => (ids ? ids.includes(f.id as string) : f.source_document_id === params[0]) && String(f.researcher_note ?? "").trim() !== "",
        );
        return { rows: noted ? [{ "?column?": 1 }] : [] };
      }

      if (s.startsWith("select storage_path, source_filename from documents")) {
        return { rows: state.documents.filter((d) => d.id === params[0] && d.run_id === params[1]) };
      }
      if (s.startsWith("update documents set extracted_text")) return { rows: [] };
      if (s.startsWith("select id from documents where id = $1 and run_id = $2 for update")) {
        return { rows: state.documents.filter((d) => d.id === params[0] && d.run_id === params[1]).map((d) => ({ id: d.id })) };
      }
      if (s.startsWith("select id, status, researcher_note, source_quote, source_page, finding_text, cited_support_finding_ids")) {
        const fallback = s.includes("false as provenance_tracked");
        return {
          rows: state.findings
            .filter((f) => f.source_document_id === params[0])
            .sort((a, b) => (a.created_seq as number) - (b.created_seq as number))
            .map((f) => ({
              id: f.id,
              status: f.status,
              researcher_note: f.researcher_note ?? null,
              source_quote: f.source_quote ?? null,
              source_page: f.source_page ?? null,
              finding_text: f.finding_text,
              cited_support_finding_ids: structuredClone(f.cited_support_finding_ids ?? []),
              human_reviewed_at: fallback ? null : (f.human_reviewed_at ?? null),
              human_edited_fields: fallback ? [] : [...((f.human_edited_fields as string[]) ?? [])],
              provenance_tracked: fallback ? false : f.provenance_tracked === true,
            })),
        };
      }
      if (s.startsWith("select distinct finding_id from insights where finding_id = any")) {
        const ids = new Set(params[0] as string[]);
        return { rows: [...new Set(state.insights.filter((i) => ids.has(i.finding_id as string)).map((i) => i.finding_id))].map((finding_id) => ({ finding_id })) };
      }
      if (s.startsWith("insert into trace")) {
        const event = /'([a-z_]+)'/.exec(sql)?.[1] ?? "unknown_event";
        insertRow("trace", { event, detail: JSON.parse(params[2] as string) });
        return { rows: [] };
      }
      if (s.startsWith("insert into findings")) {
        if (s.includes("human_review")) throw new Error("an automatic insert must not write review provenance");
        newIds += 1;
        const row: Row = {
          id: `new-${newIds}`,
          tenant_id: params[0],
          run_id: params[1],
          origin: "stated",
          finding_text: params[2],
          finding_kind: params[3],
          theme: params[4],
          data_type: params[5],
          source_document_id: params[6],
          source_page: params[7],
          source_quote: params[8],
          quote_verified: params[9],
          status: "accepted",
          grounded_by_finding_id: params[10],
          extraction_caveats: params[11],
          researcher_note: null,
          cited_support_finding_ids: [],
          created_seq: seq++,
        };
        // 0094's column defaults, emulated: tracked, never reviewed or edited on insert.
        if (provenance) {
          Object.assign(row, {
            human_reviewed_at: null,
            human_review_action: null,
            human_edited_at: null,
            human_edited_fields: [],
            provenance_tracked: true,
          });
        }
        insertRow("findings", row);
        return { rows: [{ id: row.id, finding_text: row.finding_text }] };
      }
      if (s.startsWith("update findings set cited_support_finding_ids = $1 where id = $2")) {
        const f = state.findings.find((r) => r.id === params[1]);
        if (f) setField(f, "cited_support_finding_ids", JSON.parse(params[0] as string));
        return { rows: [] };
      }

      // findingActions.ts (researcher actions) and findingProvenance.ts writes.
      // SEC1: each of these names tenant_id as well ($4), matched against the row's tenant.
      const sameTenant = (r: Row) => r.tenant_id === undefined || r.tenant_id === params[3];
      const one = (r: Row) => r.id === params[1] && r.run_id === params[2] && sameTenant(r);
      if (s === "update findings set status = $1 where id = $2 and run_id = $3 and tenant_id = $4 returning id") return updateFindings(one, "status", params[0]);
      if (s === "update findings set finding_kind = $1 where id = $2 and run_id = $3 and tenant_id = $4 returning id") return updateFindings(one, "finding_kind", params[0]);
      if (s === "update findings set theme = $1 where id = $2 and run_id = $3 and tenant_id = $4 returning id") return updateFindings(one, "theme", params[0]);
      if (s === "update findings set researcher_note = $1 where id = $2 and run_id = $3 and tenant_id = $4 returning id") return updateFindings(one, "researcher_note", params[0]);
      if (s === "update findings set status = $1 where run_id = $2 and id = any($3::uuid[]) and tenant_id = $4 returning id") {
        const ids = new Set(params[2] as string[]);
        return updateFindings((r) => r.run_id === params[1] && ids.has(r.id as string) && sameTenant(r), "status", params[0]);
      }
      if (s.startsWith("update findings set human_reviewed_at = now(), human_review_action = $2 where id = any($1::uuid[])")) {
        const ids = new Set(params[0] as string[]);
        for (const f of state.findings.filter((r) => ids.has(r.id as string))) {
          setField(f, "human_reviewed_at", `t${seq++}`);
          setField(f, "human_review_action", params[1]);
        }
        return { rows: [] };
      }
      if (s.startsWith("update findings set human_edited_at = now(), human_edited_fields = array(")) {
        const ids = new Set(params[0] as string[]);
        for (const f of state.findings.filter((r) => ids.has(r.id as string))) {
          setField(f, "human_edited_at", `t${seq++}`);
          const fields = new Set([...(((f.human_edited_fields as string[]) ?? [])), params[1] as string]);
          setField(f, "human_edited_fields", [...fields].sort());
        }
        return { rows: [] };
      }
      // drivers.removeDriverFindings (a dashboard remove).
      if (s.startsWith("update findings set status = 'rejected' where run_id = $1 and pattern_type = 'driver'")) {
        return updateFindings(
          (r) => r.run_id === params[0] && r.pattern_type === "driver" && (r.stated_stats as Row)?.analysisId === params[1] && r.status !== "rejected",
          "status",
          "rejected",
        );
      }

      // Real findingArchive.ts statements. Only the explicit-ids scope is modelled: the
      // extraction path must always retire an exact id list, never a document-scoped sweep.
      const archiveScoped = s.includes("id = any($1)");
      const ids = archiveScoped ? new Set(params[0] as string[]) : null;
      if (s.startsWith("insert into finding_history")) {
        if (!ids) throw new Error(`unmodelled archive scope: ${sql}`);
        const copiesProvenance = s.includes("provenance_tracked");
        for (const f of state.findings.filter((r) => ids.has(r.id as string))) {
          if (state.finding_history.some((h) => h.original_finding_id === f.id)) continue;
          const h: Row = { original_finding_id: f.id, finding_text: f.finding_text, theme: f.theme, finding_kind: f.finding_kind, status: f.status, archived_reason: params[1] };
          if (copiesProvenance) {
            Object.assign(h, {
              human_reviewed_at: f.human_reviewed_at ?? null,
              human_review_action: f.human_review_action ?? null,
              human_edited_at: f.human_edited_at ?? null,
              human_edited_fields: f.human_edited_fields ?? [],
              provenance_tracked: f.provenance_tracked === true,
            });
          }
          insertRow("finding_history", h);
        }
        return { rows: [] };
      }
      if (s.startsWith("insert into verdict_history")) {
        if (!ids) throw new Error(`unmodelled archive scope: ${sql}`);
        for (const v of state.verdicts.filter((r) => ids.has(r.finding_id as string))) {
          insertRow("verdict_history", { original_finding_id: v.finding_id, original_verdict_id: v.id });
        }
        return { rows: [] };
      }
      if (s.startsWith("with picked_insights as") && s.includes("insert into insight_history")) {
        if (!ids) throw new Error(`unmodelled archive scope: ${sql}`);
        for (const fid of ids) {
          const picked = state.insights.find((i) => i.finding_id === fid);
          if (picked && !state.insight_history.some((h) => h.original_finding_id === fid)) {
            insertRow("insight_history", { original_finding_id: fid, original_insight_id: picked.id });
          }
        }
        return { rows: [] };
      }
      if (s.startsWith("with picked_insights as") && s.includes("insert into recommendation_history")) {
        if (!ids) throw new Error(`unmodelled archive scope: ${sql}`);
        for (const fid of ids) {
          const picked = state.insights.find((i) => i.finding_id === fid);
          if (!picked) continue;
          for (const r of state.recommendations.filter((x) => x.insight_id === picked.id)) {
            insertRow("recommendation_history", { original_insight_id: picked.id, original_recommendation_id: r.id });
          }
        }
        return { rows: [] };
      }
      if (s.startsWith("delete from findings")) {
        if (!ids) throw new Error(`unmodelled archive scope: ${sql}`);
        const goneInsights = new Set(state.insights.filter((i) => ids.has(i.finding_id as string)).map((i) => i.id));
        deleteWhere("recommendations", (r) => goneInsights.has(r.insight_id));
        deleteWhere("insights", (i) => ids.has(i.finding_id as string));
        deleteWhere("verdicts", (v) => ids.has(v.finding_id as string));
        for (const f of state.findings) {
          if (f.grounded_by_finding_id && ids.has(f.grounded_by_finding_id as string)) setField(f, "grounded_by_finding_id", null);
        }
        deleteWhere("findings", (f) => ids.has(f.id as string));
        return { rows: [] };
      }
      throw new Error(`unhandled fake-db query: ${sql}`);
    }

    return { query, release: () => {} };
  }

  return {
    state,
    executed,
    provenance,
    connect,
    failOn(match: RegExp, nth = 1) {
      faults.push({ match, nth });
    },
    clearFaults() {
      faults.length = 0;
    },
  };
}

export type FakeFindingsDb = ReturnType<typeof createFakeFindingsDb>;
