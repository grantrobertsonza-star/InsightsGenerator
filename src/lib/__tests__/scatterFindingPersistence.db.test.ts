// IR-01 and IR-02 (Codex independent review, 2026-10-20): a posted scatter correlation follows its
// source, and is posted once. Real disposable PostgreSQL and the actual actions; the stored file's
// column reader (runStatsTool) and the dictionary/document/label lookups in crosstabs.ts are the
// mocked boundary, as in Codex's probe.
//   - the source changes (r +1 to -1): reposting updates the same finding to -1, keeps its id and a
//     theme the researcher changed by hand, and the status check says the old one was not current
//   - a label-only change keeps the finding's identity and figures
//   - removed then posted again: the same finding comes back with the current figures
//   - a failed read leaves the finding as it was and reports the error; a retry then succeeds
//   - two posts at the same moment, and two revivals at the same moment, leave one finding
//   - weighted and unweighted correlations of the same pair are two findings
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

// The controlled source: what the stored file "contains" right now.
const source = {
  xLabel: "Ease of contact",
  yLabel: "Overall trust",
  y: [1, 2, 3, 4, 5, 6] as (number | null)[],
  x: [1, 2, 3, 4, 5, 6] as (number | null)[],
  weights: [1, 2, 1, 2, 1, 2] as (number | null)[],
  fail: false,
};

vi.mock("../crosstabs", () => ({
  loadVariableDictionaryWithStatus: vi.fn(async () => ({
    ok: true,
    dictionary: { variables: [{ name: "EASE" }, { name: "TRUST" }, { name: "WT" }] },
  })),
  loadDocumentFile: vi.fn(async () => ({ storage_path: "synthetic/file.sav", source_filename: "file.sav", selected_sheet: null })),
  overlayFor: vi.fn(async () => ({ variableLabels: { EASE: source.xLabel, TRUST: source.yLabel }, valueLabels: {}, questions: {} })),
}));

vi.mock("../parseStatsFile", () => ({
  runStatsTool: vi.fn(async (_action: string, _path: string, _name: string, args: { weightVar: string | null }) => {
    if (source.fail) throw new Error("The statistics worker could not read the file.");
    const axis = (name: string, label: string, values: (number | null)[]) => ({
      name,
      label,
      min: Math.min(...(values.filter((v) => v !== null) as number[])),
      max: Math.max(...(values.filter((v) => v !== null) as number[])),
      distinct: new Set(values).size,
    });
    return {
      outcome: axis("TRUST", source.yLabel, source.y),
      predictors: [axis("EASE", source.xLabel, source.x)],
      y: source.y,
      x: source.x.map((v) => [v]),
      weights: args.weightVar ? source.weights : null,
      n: source.y.length,
      skipped: [],
    };
  }),
}));

describe.skipIf(!TEST_DATABASE_URL)("scatter findings follow their source and are posted once", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string, data: string;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic scatter')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id) values($1) returning id", [tenant])).rows[0].id;
    data = (
      await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,ingestion_type) values($1,$2,'table','file.sav','synthetic/file.sav','raw') returning id", [tenant, run])
    ).rows[0].id;
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  const rows = async (weight: string | null = null) =>
    (
      await db.pool.query(
        `select id, status, theme, finding_text, stated_stats from findings
         where run_id = $1 and stated_stats->>'source' = 'scatter_tool' and coalesce(stated_stats->>'weightVar','') = coalesce($2,'')
         order by created_at, id`,
        [run, weight],
      )
    ).rows;
  const reset = async () => {
    await db.pool.query("delete from findings where run_id = $1", [run]);
    Object.assign(source, { xLabel: "Ease of contact", yLabel: "Overall trust", x: [1, 2, 3, 4, 5, 6], y: [1, 2, 3, 4, 5, 6], fail: false });
  };

  it("updates a changed source in place and keeps a hand-set theme", async () => {
    await reset();
    const { addScatterFindingAction, scatterFindingStatusAction } = await import("../scatterActions");
    expect(await addScatterFindingAction(run, data, "EASE", "TRUST", null)).toEqual({ ok: true, added: true, updated: false });
    const [first] = await rows();
    expect(first.stated_stats.r).toBe(1);
    expect(typeof first.stated_stats.basis).toBe("string");
    // The researcher renames the theme by hand (recorded as an edit, migration 0094).
    await db.pool.query("update findings set theme = 'Contact and trust', human_edited_fields = array['theme'] where id = $1", [first.id]);

    // Unchanged: posting again changes nothing.
    expect(await addScatterFindingAction(run, data, "EASE", "TRUST", null)).toEqual({ ok: true, added: false, updated: false });

    // The source changes: the same variables now run the other way.
    source.y = [6, 5, 4, 3, 2, 1];
    expect(await addScatterFindingAction(run, data, "EASE", "TRUST", null)).toEqual({ ok: true, added: false, updated: true });
    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(first.id);
    expect(after[0].stated_stats.r).toBe(-1);
    expect(after[0].finding_text).toMatch(/r = -1/);
    expect(after[0].theme).toBe("Contact and trust");
    expect((await scatterFindingStatusAction(run, data, "EASE", "TRUST", null))).toEqual({ ok: true, committed: true, current: true });
  });

  it("says a posted correlation is not current when what it was read from changed, and unknown before it was recorded", async () => {
    await reset();
    const { addScatterFindingAction, scatterFindingStatusAction } = await import("../scatterActions");
    await addScatterFindingAction(run, data, "EASE", "TRUST", null);
    // The saved layout of the file changes after posting.
    await db.pool.query(`update documents set data_setup = '{"layout":"columns_are_cases"}'::jsonb where id = $1`, [data]);
    expect(await scatterFindingStatusAction(run, data, "EASE", "TRUST", null)).toEqual({ ok: true, committed: true, current: false });
    await db.pool.query("update documents set data_setup = null where id = $1", [data]);
    // A finding posted before the basis was recorded: unknown, never current.
    await db.pool.query("update findings set stated_stats = stated_stats - 'basis' where run_id = $1", [run]);
    expect(await scatterFindingStatusAction(run, data, "EASE", "TRUST", null)).toEqual({ ok: true, committed: true, current: null });
  });

  it("keeps identity and figures when only a label changes", async () => {
    await reset();
    const { addScatterFindingAction, scatterFindingStatusAction } = await import("../scatterActions");
    await addScatterFindingAction(run, data, "EASE", "TRUST", null);
    const [before] = await rows();
    source.xLabel = "How easy it was to reach us";
    expect(await scatterFindingStatusAction(run, data, "EASE", "TRUST", null)).toEqual({ ok: true, committed: true, current: false });
    const res = await addScatterFindingAction(run, data, "EASE", "TRUST", null);
    expect(res).toMatchObject({ ok: true, added: false });
    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    expect(after[0].stated_stats.variable1).toBe("EASE");
    expect(after[0].stated_stats.r).toBe(before.stated_stats.r);
    expect(after[0].stated_stats.n).toBe(before.stated_stats.n);
    expect(await scatterFindingStatusAction(run, data, "EASE", "TRUST", null)).toEqual({ ok: true, committed: true, current: true });
  });

  it("brings a removed finding back with the current figures", async () => {
    await reset();
    const { addScatterFindingAction, removeScatterFindingAction } = await import("../scatterActions");
    await addScatterFindingAction(run, data, "EASE", "TRUST", null);
    const [first] = await rows();
    expect(await removeScatterFindingAction(run, data, "EASE", "TRUST", null)).toEqual({ ok: true, removed: 1 });
    source.y = [6, 5, 4, 3, 2, 1];
    expect(await addScatterFindingAction(run, data, "EASE", "TRUST", null)).toEqual({ ok: true, added: true, updated: true });
    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: first.id, status: "accepted" });
    expect(after[0].stated_stats.r).toBe(-1);
  });

  it("leaves the finding unchanged when the read fails, and a retry succeeds", async () => {
    await reset();
    const { addScatterFindingAction } = await import("../scatterActions");
    await addScatterFindingAction(run, data, "EASE", "TRUST", null);
    const before = await rows();
    source.y = [6, 5, 4, 3, 2, 1];
    source.fail = true;
    const failed = await addScatterFindingAction(run, data, "EASE", "TRUST", null);
    expect(failed).toEqual({ ok: false, error: "The statistics worker could not read the file." });
    expect(await rows()).toEqual(before);
    source.fail = false;
    expect(await addScatterFindingAction(run, data, "EASE", "TRUST", null)).toEqual({ ok: true, added: false, updated: true });
    expect((await rows())[0].stated_stats.r).toBe(-1);
  });

  // Holds the file's row so both requests are past their file read and waiting together, then lets go.
  const race = async <T,>(start: () => Promise<T>[]) => {
    const blocker = new Client({ connectionString: db.url });
    await blocker.connect();
    await blocker.query("begin");
    await blocker.query("select id from documents where id = $1 for update", [data]);
    const pending = start();
    await new Promise((r) => setTimeout(r, 400));
    const waiting = await db.pool.query("select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()");
    await blocker.query("commit");
    await blocker.end();
    return { results: await Promise.all(pending), waiting: waiting.rows[0].n as number };
  };

  it("two posts at the same moment leave one finding", async () => {
    await reset();
    const { addScatterFindingAction } = await import("../scatterActions");
    const { results, waiting } = await race(() => [
      addScatterFindingAction(run, data, "EASE", "TRUST", null),
      addScatterFindingAction(run, data, "EASE", "TRUST", null),
    ]);
    expect(waiting).toBe(2);
    expect(results.map((r) => (r.ok ? r.added : null)).sort()).toEqual([false, true]);
    expect(await rows()).toHaveLength(1);
  });

  it("two revivals at the same moment bring back one finding", async () => {
    await reset();
    const { addScatterFindingAction, removeScatterFindingAction } = await import("../scatterActions");
    await addScatterFindingAction(run, data, "EASE", "TRUST", null);
    await removeScatterFindingAction(run, data, "EASE", "TRUST", null);
    const { results } = await race(() => [
      addScatterFindingAction(run, data, "EASE", "TRUST", null),
      addScatterFindingAction(run, data, "EASE", "TRUST", null),
    ]);
    expect(results.map((r) => (r.ok ? r.added : null)).sort()).toEqual([false, true]);
    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe("accepted");
  });

  it("keeps the weighted and unweighted correlations of a pair apart", async () => {
    await reset();
    const { addScatterFindingAction } = await import("../scatterActions");
    expect(await addScatterFindingAction(run, data, "EASE", "TRUST", null)).toMatchObject({ ok: true, added: true });
    expect(await addScatterFindingAction(run, data, "EASE", "TRUST", "WT")).toMatchObject({ ok: true, added: true });
    expect(await rows(null)).toHaveLength(1);
    const weighted = await rows("WT");
    expect(weighted).toHaveLength(1);
    expect(weighted[0].stated_stats).toMatchObject({ weighted: true, pValue: null });
  });

  it("refuses a data file of another project, writing nothing", async () => {
    await reset();
    const otherRun = (await db.pool.query("insert into runs(tenant_id) values($1) returning id", [tenant])).rows[0].id;
    const { addScatterFindingAction } = await import("../scatterActions");
    const res = await addScatterFindingAction(otherRun, data, "EASE", "TRUST", null);
    expect(res).toEqual({ ok: false, error: "That data file is not in this project." });
    expect((await db.pool.query("select count(*)::int as n from findings where run_id = $1", [otherRun])).rows[0].n).toBe(0);
  });
});
