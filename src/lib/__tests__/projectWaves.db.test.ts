// Waves in one project through the real save and the real list (Grant, 27 October 2026), against a
// disposable PostgreSQL: the fieldwork month and the include switch are saved with the file's set-up
// (compare-and-swap kept), and Wave tracking gets the included waves in fieldwork order.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

describe.skipIf(!TEST_DATABASE_URL)("waves in one project (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run = "";
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Waves')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'Tracker') returning id", [tenant])).rows[0].id;
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); }, 60000);

  const file = async (name: string, at: string) =>
    (await db.pool.query("insert into documents(tenant_id,run_id,kind,ingestion_type,source_filename,storage_path,uploaded_at) values($1,$2,'table','raw',$3,'x',$4) returning id", [tenant, run, name, at])).rows[0].id as string;

  it("saves the fieldwork month and the include switch, and lists the included waves in fieldwork order", async () => {
    const { saveDataSetupAction } = await import("../dataSetupActions");
    const { listWaveFilesAction } = await import("../waveTrackingActions");
    const { DEFAULT_DATA_SETUP } = await import("../dataSetupShared");
    // Uploaded out of order: wave 3 first.
    const w3 = await file("w3.sav", "2026-10-01T08:00:00Z");
    const w1 = await file("w1.sav", "2026-10-02T08:00:00Z");
    const w2 = await file("w2.sav", "2026-10-03T08:00:00Z");
    for (const [id, wave] of [[w3, "Wave 3"], [w1, "Wave 1"], [w2, "Wave 2"]]) {
      expect(await saveDataSetupAction(run, id, { ...DEFAULT_DATA_SETUP, accepted: true, wave }, { kind: "none" })).toMatchObject({ ok: true });
    }
    let r = await listWaveFilesAction(run);
    expect(r).toMatchObject({ ok: true, order: expect.stringMatching(/^Waves in upload order, oldest first: "Wave 3", "Wave 1", "Wave 2" have no fieldwork date/) });
    if (!r.ok) throw new Error(r.error);
    expect(r.files.map((f) => f.wave)).toEqual(["Wave 3", "Wave 1", "Wave 2"]);

    const set = async (id: string, wave: string, patch: object) => {
      const current = (await db.pool.query("select data_setup from documents where id=$1", [id])).rows[0].data_setup;
      return saveDataSetupAction(run, id, { ...current, wave, ...patch }, { kind: "value", setup: current });
    };
    expect(await set(w1, "Wave 1", { waveDate: "2026-01" })).toMatchObject({ ok: true });
    expect(await set(w2, "Wave 2", { waveDate: "2026-04" })).toMatchObject({ ok: true });
    expect(await set(w3, "Wave 3", { waveDate: "2026-07" })).toMatchObject({ ok: true });
    r = await listWaveFilesAction(run);
    if (!r.ok) throw new Error(r.error);
    expect(r.files.map((f) => [f.wave, f.waveDate])).toEqual([["Wave 1", "2026-01"], ["Wave 2", "2026-04"], ["Wave 3", "2026-07"]]);
    expect(r.order).toBe("Waves in order of fieldwork date.");

    // Wave 2 taken out: not in the analysis, still listed as left out; and an invalid date is not stored.
    expect(await set(w2, "Wave 2", { waveIncluded: false, waveDate: "April" })).toMatchObject({ ok: true });
    r = await listWaveFilesAction(run);
    if (!r.ok) throw new Error(r.error);
    expect(r.files.map((f) => f.wave)).toEqual(["Wave 1", "Wave 3"]);
    expect(r.excluded.map((f) => [f.wave, f.waveDate])).toEqual([["Wave 2", null]]);

    // A stale view is refused (compare-and-swap kept), and nothing changes.
    const { DEFAULT_DATA_SETUP: d } = await import("../dataSetupShared");
    expect(await saveDataSetupAction(run, w1, { ...d, accepted: true, wave: "Wave 1", waveIncluded: false }, { kind: "value", setup: { ...d, accepted: true, wave: "Wave 1" } })).toMatchObject({ ok: false, conflict: true });
    r = await listWaveFilesAction(run);
    if (!r.ok) throw new Error(r.error);
    expect(r.files.map((f) => f.wave)).toEqual(["Wave 1", "Wave 3"]);
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("waves in one project (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
