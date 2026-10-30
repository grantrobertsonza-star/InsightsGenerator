// Codex E1-F02 through the real save (compare-and-swap) and the Setup tab's retry (saveSetupEdit), on a disposable
// PostgreSQL: an acceptance pressed on a view whose structure was changed elsewhere is refused, re-applied never, and the
// file stays unaccepted with the other structure, for each structure field; the other interleaving (a structure change
// here meeting an acceptance there) asks for acceptance again; a wave label still merges; accepting after reloading the
// changed structure succeeds.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import type { DataSetup } from "../dataSetupShared";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

describe.skipIf(!TEST_DATABASE_URL)("E1-F02: Setup acceptance meets a structure changed elsewhere (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run = "";
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Setup')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'Setup race') returning id", [tenant])).rows[0].id;
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); }, 60000);

  const fileWith = async (setup: DataSetup) => {
    const id = (await db.pool.query("insert into documents(tenant_id,run_id,kind,ingestion_type,source_filename,storage_path) values($1,$2,'table','raw','f.csv','x') returning id", [tenant, run])).rows[0].id as string;
    const { saveDataSetupAction } = await import("../dataSetupActions");
    expect(await saveDataSetupAction(run, id, setup, { kind: "none" })).toMatchObject({ ok: true });
    return id;
  };
  const saved = async (id: string) => {
    const { loadDataSetup } = await import("../dataSetup");
    return loadDataSetup(tenant, id);
  };
  const tab = async (id: string) => {
    const { saveDataSetupAction } = await import("../dataSetupActions");
    return (setup: DataSetup, expected: { kind: "value"; setup: DataSetup }) => saveDataSetupAction(run, id, setup, expected);
  };
  const changes: Record<string, (s: DataSetup) => DataSetup> = {
    layout: (s) => ({ ...s, layout: "columns_are_cases" }),
    unit: (s) => ({ ...s, unit: "businesses" }),
    method: (s) => ({ ...s, method: "panel" }),
  };

  for (const [field, change] of Object.entries(changes)) {
    it(`${field}: B changes it unaccepted, A accepts the old view: refused, never retried, stays unaccepted with B's ${field}`, async () => {
      const { DEFAULT_DATA_SETUP } = await import("../dataSetupShared");
      const { saveSetupEdit } = await import("../dataSetupRebase");
      const original: DataSetup = { ...DEFAULT_DATA_SETUP, accepted: false };
      const id = await fileWith(original);
      const save = await tab(id);
      expect(await save(change(original), { kind: "value", setup: original })).toMatchObject({ ok: true });
      const r = await saveSetupEdit(save, original, { ...original, accepted: true });
      expect(r).toMatchObject({ status: "conflict", current: change(original) });
      expect(await saved(id)).toMatchObject({ ...change(original), accepted: false });
    });
    it(`${field}: changed here while accepted elsewhere: saved, asking for acceptance again`, async () => {
      const { DEFAULT_DATA_SETUP } = await import("../dataSetupShared");
      const { saveSetupEdit } = await import("../dataSetupRebase");
      const original: DataSetup = { ...DEFAULT_DATA_SETUP, accepted: false };
      const id = await fileWith(original);
      const save = await tab(id);
      expect(await save({ ...original, accepted: true }, { kind: "value", setup: original })).toMatchObject({ ok: true });
      const r = await saveSetupEdit(save, original, change(original));
      expect(r).toMatchObject({ status: "saved" });
      expect(await saved(id)).toMatchObject({ ...change(original), accepted: false });
    });
  }

  it("a wave label typed while the structure changed elsewhere merges, keeping that structure unaccepted", async () => {
    const { DEFAULT_DATA_SETUP } = await import("../dataSetupShared");
    const { saveSetupEdit } = await import("../dataSetupRebase");
    const original: DataSetup = { ...DEFAULT_DATA_SETUP, accepted: false };
    const id = await fileWith(original);
    const save = await tab(id);
    await save(changes.layout(original), { kind: "value", setup: original });
    expect(await saveSetupEdit(save, original, { ...original, wave: "Wave 2" })).toMatchObject({ status: "saved" });
    expect(await saved(id)).toMatchObject({ layout: "columns_are_cases", accepted: false, wave: "Wave 2" });
  });

  it("recovery: after reloading the changed structure, accepting it succeeds", async () => {
    const { DEFAULT_DATA_SETUP } = await import("../dataSetupShared");
    const { saveSetupEdit } = await import("../dataSetupRebase");
    const original: DataSetup = { ...DEFAULT_DATA_SETUP, accepted: false };
    const id = await fileWith(original);
    const save = await tab(id);
    await save(changes.layout(original), { kind: "value", setup: original });
    const reloaded = await saved(id);
    expect(await saveSetupEdit(save, reloaded, { ...reloaded, accepted: true })).toMatchObject({ status: "saved" });
    expect(await saved(id)).toMatchObject({ layout: "columns_are_cases", accepted: true });
  });
});
