// D2 (Grant, 29 October 2026): a tracker dashboard's choices are saved once per programme and carried to every
// wave; weighted by default when the file has a weight. Through the actual loadTrackerDashboard,
// saveTrackerChoices and resetTrackerChoices with the local engine and a real database (storage is an
// in-memory stand-in). Data: the BMW wave as SPSS with its labels only (fixtures/tracker-packs/bmw_car), no
// codebook.
//   - first view: suggestions only, weighted by the file's weight, the main brand pre-filled from the programme
//     name and still asked;
//   - a save on wave 1 is seen on wave 2 of the same programme, saying it came from another wave;
//   - compare-and-swap: two first saves, or a save from a stale revision, are refused with the current choices
//     and change nothing; a retry with the current revision succeeds;
//   - invalid choices are refused on the server; a project in no programme keeps its own; another tenant's
//     project is refused;
//   - Reset to suggested clears the choices, keeps them as previous_choices, and the suggestions apply again.
// Skipped, with the reason, without a test database or python3 + pandas/pyreadstat.
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

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("tracker dashboard choices per programme (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  let program = "";
  let wave1 = { run: "", doc: "" };
  let wave2 = { run: "", doc: "" };

  async function project(name: string, programId: string | null, wave: string | null) {
    const run = (await q("insert into runs (tenant_id, project_name, program_id, wave_label) values ($1, $2, $3, $4) returning id", [tenant, name, programId, wave]))[0].id as string;
    const key = `${tenant}/${run}/${randomUUID()}-bmw.sav`;
    storage.objects.set(key, SAV);
    const doc = (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
       values ($1, $2, 'table', 'raw', 'bmw.sav', $3, $4) returning id`,
      [tenant, run, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true })],
    ))[0].id as string;
    return { run, doc };
  }

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    program = (await q("insert into programs (tenant_id, name) values ($1, 'BMW car tracker') returning id", [tenant]))[0].id;
    wave1 = await project("Car tracker February", program, "Wave 1");
    wave2 = await project("Car tracker June", program, "Wave 2");
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });
  const lib = () => import("../trackerDashboards");
  const inProgramme = (revision: number | null) => ({ scope: `programme:${program}`, revision });

  it("first view: the suggestion, weighted by default, the main brand pre-filled and still asked", async () => {
    const { loadTrackerDashboard } = await lib();
    const v = await loadTrackerDashboard(tenant, wave1.run, wave1.doc);
    expect(v.storageAvailable).toBe(true);
    expect(v.scope).toBe("programme");
    expect(v.scopeKey).toBe(`programme:${program}`);
    expect(v.revision).toBeNull();
    expect(v.recognition.type).toBe("brand");
    expect([v.dashboard.weighted, v.dashboard.weightVar, v.dashboard.weightSource]).toEqual([true, "weight", "default"]);
    expect(v.dashboard.focalBrand).toEqual({ code: "8", label: "BMW", source: "prefilled" });
    expect(v.dashboard.needsChoice.map((n) => n.id)).toContain("focal-brand");
  });

  it("a save on wave 1 is the programme's: wave 2 shows it and says where it came from", async () => {
    const { loadTrackerDashboard, saveTrackerChoices } = await lib();
    const saved = await saveTrackerChoices(tenant, wave1.run, wave1.doc, inProgramme(null), { focalBrandCode: "8", weighted: false, stages: { repeat12: null } }, "grant@example.com");
    expect(saved).toEqual({ saved: true, revision: 1 });
    const v = await loadTrackerDashboard(tenant, wave2.run, wave2.doc);
    expect(v.revision).toBe(1);
    expect(v.dashboard.focalBrand).toEqual({ code: "8", label: "BMW", source: "chosen" });
    expect([v.dashboard.weighted, v.dashboard.weightSource]).toEqual([false, "chosen"]);
    expect(v.dashboard.stages.find((s) => s.group === "repeat12")).toMatchObject({ stage: null, source: "chosen" });
    expect(v.choicesFrom).toMatchObject({ runId: wave1.run, documentId: wave1.doc, thisWave: false, by: "grant@example.com" });
    const rows = await q("select program_id, run_id, revision, suggested->>'rules' as rules from tracker_dashboards where tenant_id = $1", [tenant]);
    expect(rows).toEqual([{ program_id: program, run_id: null, revision: 1, rules: "d1-2026-10-29" }]);
  });

  it("compare-and-swap: a second first save and a stale save are refused with the current choices; nothing changes", async () => {
    const { saveTrackerChoices } = await lib();
    const first = await saveTrackerChoices(tenant, wave2.run, wave2.doc, inProgramme(null), { focalBrandCode: "1" }, "other");
    expect(first).toMatchObject({ saved: false, reason: "conflict", current: { revision: 1, choices: { focalBrandCode: "8" } } });
    const ok = await saveTrackerChoices(tenant, wave2.run, wave2.doc, inProgramme(1), { focalBrandCode: "8", weighted: true }, "grant@example.com");
    expect(ok).toEqual({ saved: true, revision: 2 });
    const stale = await saveTrackerChoices(tenant, wave1.run, wave1.doc, inProgramme(1), { focalBrandCode: "2" }, "other");
    expect(stale).toMatchObject({ saved: false, reason: "conflict", current: { revision: 2, choices: { focalBrandCode: "8", weighted: true } } });
    expect((await q("select revision, choices from tracker_dashboards"))[0]).toEqual({ revision: 2, choices: { focalBrandCode: "8", weighted: true } });
  });

  it("simultaneous first saves of a new programme: exactly one wins", async () => {
    const { saveTrackerChoices } = await lib();
    const p2 = (await q("insert into programs (tenant_id, name) values ($1, 'Second') returning id", [tenant]))[0].id;
    const a = await project("A", p2, "1");
    const b = await project("B", p2, "2");
    const results = await Promise.all([
      saveTrackerChoices(tenant, a.run, a.doc, { scope: `programme:${p2}`, revision: null }, { focalBrandCode: "3" }, "a"),
      saveTrackerChoices(tenant, b.run, b.doc, { scope: `programme:${p2}`, revision: null }, { focalBrandCode: "4" }, "b"),
    ]);
    expect(results.filter((r) => r.saved)).toHaveLength(1);
    expect(results.filter((r) => !r.saved && r.reason === "conflict")).toHaveLength(1);
    expect(await q("select count(*)::int as n from tracker_dashboards where program_id = $1", [p2])).toEqual([{ n: 1 }]);
  });

  it("choices are checked on the server; nothing invalid is saved", async () => {
    const { saveTrackerChoices } = await lib();
    const r = await saveTrackerChoices(tenant, wave1.run, wave1.doc, inProgramme(2), { focalBrandCode: "96", stages: { consider: "loyalty" }, csm: { recommend0to10: "nope" } }, "x");
    expect(r).toEqual({
      saved: false,
      reason: "invalid",
      problems: ["Brand code 96 is not in this file's brand list.", '"loyalty" is not a funnel stage.', "nope is not a variable in this file."],
    });
    expect((await q("select revision from tracker_dashboards where program_id = $1", [program]))[0].revision).toBe(2);
  });

  it("a project in no programme keeps its own choices; another tenant's project and a file from another project are refused", async () => {
    const { saveTrackerChoices, loadTrackerDashboard } = await lib();
    const alone = await project("Ad hoc", null, null);
    expect((await loadTrackerDashboard(tenant, alone.run, alone.doc)).scope).toBe("project");
    expect(await saveTrackerChoices(tenant, alone.run, alone.doc, { scope: `project:${alone.run}`, revision: null }, { focalBrandCode: "1" }, "x")).toEqual({ saved: true, revision: 1 });
    expect((await loadTrackerDashboard(tenant, wave1.run, wave1.doc)).choices.focalBrandCode).toBe("8");
    await expect(saveTrackerChoices(tenant, alone.run, wave1.doc, { scope: `project:${alone.run}`, revision: 1 }, { focalBrandCode: "1" }, "x")).rejects.toThrow(/not found for this run|no longer in this project/);
    const other = randomUUID();
    await q("insert into tenants (id, name) values ($1, 'Other')", [other]);
    await expect(saveTrackerChoices(other, wave1.run, wave1.doc, inProgramme(2), {}, "x")).rejects.toThrow();
    expect((await q("select revision from tracker_dashboards where program_id = $1", [program]))[0].revision).toBe(2);
  });

  it("Reset to suggested: choices cleared and kept as previous; suggestions apply again; a stale reset is refused", async () => {
    const { resetTrackerChoices, loadTrackerDashboard } = await lib();
    expect(await resetTrackerChoices(tenant, wave1.run, inProgramme(1), "grant@example.com")).toMatchObject({ saved: false, reason: "conflict", current: { revision: 2 } });
    expect(await resetTrackerChoices(tenant, wave1.run, inProgramme(2), "grant@example.com")).toEqual({ saved: true, revision: 3 });
    const row = (await q("select choices, previous_choices, reset_at is not null as reset from tracker_dashboards where program_id = $1", [program]))[0];
    expect(row).toEqual({ choices: {}, previous_choices: { focalBrandCode: "8", weighted: true }, reset: true });
    const v = await loadTrackerDashboard(tenant, wave2.run, wave2.doc);
    expect([v.revision, v.dashboard.focalBrand?.source, v.dashboard.weightSource, v.choicesFrom]).toEqual([3, "prefilled", "default", null]);
    expect(v.resetAt).not.toBeNull();
  });
});
