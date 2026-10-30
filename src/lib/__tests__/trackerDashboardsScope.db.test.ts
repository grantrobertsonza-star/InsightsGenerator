// Codex D2A-F01 (29 October 2026): a dashboard save or reset carries the scope (programme, or project in none) and
// revision the screen read, rechecked under the project's lock; a project moved since the view is refused and
// changes neither scope. Before the repair the revision alone was compared, so a view of programme A saved after
// its project moved to B at an equal revision replaced B's choices. Real disposable PostgreSQL and the actual engine
// (the BMW wave as SPSS with its labels); storage is an in-memory stand-in. Skipped, with the reason, without a test
// database or python3 + pandas/pyreadstat.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));

const storage = vi.hoisted(() => ({ objects: new Map<string, Buffer>() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: async (key: string) => (storage.objects.has(key) ? { data: new Blob([new Uint8Array(storage.objects.get(key)!)]), error: null } : { data: null, error: { message: "not found" } }),
        remove: async () => ({ data: [], error: null }),
        upload: async () => ({ data: {}, error: null }),
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat"], { encoding: "utf8" }).status === 0;
const SAV = readFileSync(path.join(process.cwd(), "fixtures", "tracker-packs", "bmw_car", "wave1_first20_labels_only.sav"));

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("D2A-F01: a save or reset is bound to the scope it read (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const programme = async (name: string) => (await q("insert into programs (tenant_id, name) values ($1, $2) returning id", [tenant, name]))[0].id as string;
  async function project(name: string, programId: string | null) {
    const run = (await q("insert into runs (tenant_id, project_name, program_id) values ($1, $2, $3) returning id", [tenant, name, programId]))[0].id as string;
    const key = `${tenant}/${run}/${randomUUID()}-bmw.sav`;
    storage.objects.set(key, SAV);
    const doc = (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
       values ($1, $2, 'table', 'raw', 'bmw.sav', $3, $4) returning id`,
      [tenant, run, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true })],
    ))[0].id as string;
    return { run, doc };
  }
  const moveTo = (run: string, programId: string | null) => q("update runs set program_id = $1 where id = $2", [programId, run]);
  const rows = () => q("select program_id, run_id, revision, choices from tracker_dashboards order by created_at");

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });
  const lib = () => import("../trackerDashboards");

  it("moved from programme A to B at equal revisions: the stale save is refused and B is unchanged; after a reload it saves to B", async () => {
    const { saveTrackerChoices, loadTrackerDashboard } = await lib();
    const [a, b] = [await programme("A"), await programme("B")];
    const viewer = await project("viewer", a);
    const other = await project("other", b);
    expect(await saveTrackerChoices(tenant, viewer.run, viewer.doc, { scope: `programme:${a}`, revision: null }, { focalBrandCode: "1" }, "x")).toEqual({ saved: true, revision: 1 });
    expect(await saveTrackerChoices(tenant, other.run, other.doc, { scope: `programme:${b}`, revision: null }, { focalBrandCode: "2" }, "x")).toEqual({ saved: true, revision: 1 });
    const seen = await loadTrackerDashboard(tenant, viewer.run, viewer.doc);
    expect([seen.scopeKey, seen.revision]).toEqual([`programme:${a}`, 1]);
    await moveTo(viewer.run, b);
    const stale = await saveTrackerChoices(tenant, viewer.run, viewer.doc, { scope: seen.scopeKey, revision: seen.revision }, { focalBrandCode: "3" }, "x");
    expect(stale).toEqual({ saved: false, reason: "conflict", moved: true, current: { scope: `programme:${b}`, revision: 1, choices: { focalBrandCode: "2" } } });
    expect((await rows()).map((r) => [r.program_id, r.revision, r.choices.focalBrandCode])).toEqual([[a, 1, "1"], [b, 1, "2"]]);
    // Retry after a reload: the view now reads programme B, and the save goes there.
    const fresh = await loadTrackerDashboard(tenant, viewer.run, viewer.doc);
    expect(await saveTrackerChoices(tenant, viewer.run, viewer.doc, { scope: fresh.scopeKey, revision: fresh.revision }, { focalBrandCode: "3" }, "x")).toEqual({ saved: true, revision: 2 });
    expect((await rows()).map((r) => [r.program_id, r.revision, r.choices.focalBrandCode])).toEqual([[a, 1, "1"], [b, 2, "3"]]);
  });

  it("both scopes empty: a first save from the old scope is refused and creates nothing", async () => {
    const { saveTrackerChoices } = await lib();
    const [c, d] = [await programme("C"), await programme("D")];
    const p = await project("p", c);
    await moveTo(p.run, d);
    const r = await saveTrackerChoices(tenant, p.run, p.doc, { scope: `programme:${c}`, revision: null }, { focalBrandCode: "1" }, "x");
    expect(r).toMatchObject({ saved: false, reason: "conflict", moved: true, current: { scope: `programme:${d}`, revision: null } });
    expect(await q("select count(*)::int as n from tracker_dashboards where program_id = any($1)", [[c, d]])).toEqual([{ n: 0 }]);
  });

  it("project to programme and programme to project: both refused; neither scope changes", async () => {
    const { saveTrackerChoices } = await lib();
    const e = await programme("E");
    const alone = await project("alone", null);
    expect(await saveTrackerChoices(tenant, alone.run, alone.doc, { scope: `project:${alone.run}`, revision: null }, { focalBrandCode: "4" }, "x")).toEqual({ saved: true, revision: 1 });
    await moveTo(alone.run, e);
    expect(await saveTrackerChoices(tenant, alone.run, alone.doc, { scope: `project:${alone.run}`, revision: 1 }, { focalBrandCode: "5" }, "x")).toMatchObject({ saved: false, reason: "conflict", moved: true, current: { scope: `programme:${e}` } });
    const inE = await project("inE", e);
    await moveTo(inE.run, null);
    expect(await saveTrackerChoices(tenant, inE.run, inE.doc, { scope: `programme:${e}`, revision: null }, { focalBrandCode: "6" }, "x")).toMatchObject({ saved: false, reason: "conflict", moved: true, current: { scope: `project:${inE.run}`, revision: null } });
    expect(await q("select revision, choices from tracker_dashboards where run_id = $1", [alone.run])).toEqual([{ revision: 1, choices: { focalBrandCode: "4" } }]);
    expect(await q("select count(*)::int as n from tracker_dashboards where program_id = $1 or run_id = $2", [e, inE.run])).toEqual([{ n: 0 }]);
  });

  it("a stale reset after a move is refused and resets nothing", async () => {
    const { saveTrackerChoices, resetTrackerChoices } = await lib();
    const [f, g] = [await programme("F"), await programme("G")];
    const p = await project("p2", f);
    const o = await project("o2", g);
    await saveTrackerChoices(tenant, p.run, p.doc, { scope: `programme:${f}`, revision: null }, { focalBrandCode: "1" }, "x");
    await saveTrackerChoices(tenant, o.run, o.doc, { scope: `programme:${g}`, revision: null }, { focalBrandCode: "2" }, "x");
    await moveTo(p.run, g);
    expect(await resetTrackerChoices(tenant, p.run, { scope: `programme:${f}`, revision: 1 }, "x")).toMatchObject({ saved: false, reason: "conflict", moved: true, current: { scope: `programme:${g}`, revision: 1 } });
    expect(await q("select program_id, revision, choices, previous_choices from tracker_dashboards where program_id = any($1) order by created_at", [[f, g]])).toEqual([
      { program_id: f, revision: 1, choices: { focalBrandCode: "1" }, previous_choices: null },
      { program_id: g, revision: 1, choices: { focalBrandCode: "2" }, previous_choices: null },
    ]);
  });
});
