// R3e1, Codex's E1R waves-in-project receipt (persisted Wave 2 with waveDate null and still included, while the screen
// showed June 2026 and the box unticked): one file's Setup edits made in quick succession, through the real save
// (saveDataSetupAction, compare-and-swap) on a disposable PostgreSQL. Edits are sent one at a time, each applied to what
// the previous one saved, so a fieldwork month and an inclusion choice made while the wave label's save is still on its
// way are all kept, also when the form's starting view is behind what is saved. A save that throws is reported failed
// without stalling later edits; a change made in another tab still merges or conflicts as before (E1-F02).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import type { DataSetup } from "../dataSetupShared";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!TEST_DATABASE_URL)("Setup edits in quick succession are all saved (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run = "";
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Setup')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'Setup queue') returning id", [tenant])).rows[0].id;
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); }, 60000);

  const fileWith = async (setup: DataSetup) => {
    const id = (await db.pool.query("insert into documents(tenant_id,run_id,kind,ingestion_type,source_filename,storage_path) values($1,$2,'table','raw','w2.csv','x') returning id", [tenant, run])).rows[0].id as string;
    const { saveDataSetupAction } = await import("../dataSetupActions");
    expect(await saveDataSetupAction(run, id, setup, { kind: "none" })).toMatchObject({ ok: true });
    return id;
  };
  const saved = async (id: string) => (await import("../dataSetup")).loadDataSetup(tenant, id);
  /** The real save action with a network delay; records how many saves were on their way at once and what each expected. */
  const network = async (id: string, opts: { failOnCall?: number } = {}) => {
    const { saveDataSetupAction } = await import("../dataSetupActions");
    const log = { calls: 0, inFlight: 0, maxInFlight: 0, expected: [] as DataSetup[] };
    const save = async (setup: DataSetup, expected: { kind: "value"; setup: DataSetup }) => {
      const call = ++log.calls;
      log.inFlight++;
      log.maxInFlight = Math.max(log.maxInFlight, log.inFlight);
      log.expected.push(expected.setup);
      try {
        await sleep(30);
        if (call === opts.failOnCall) throw new Error("network: the response was lost (test)");
        return await saveDataSetupAction(run, id, setup, expected);
      } finally {
        log.inFlight--;
      }
    };
    return { save, log };
  };

  /** The Setup tab's three edits on Wave 2, each made on the screen's view after the previous one (not awaited). */
  const threeEdits = async (queue: import("../dataSetupRebase").SetupEditQueue, start: DataSetup) => {
    const v1 = { ...start, wave: "Wave 2" };
    const v2 = { ...v1, waveDate: "2026-06" };
    const v3 = { ...v2, waveIncluded: false };
    return Promise.all([queue.edit(start, v1), queue.edit(v1, v2), queue.edit(v2, v3)]);
  };

  it("the receipt: the form's view is behind what is saved (accepted elsewhere); label, month and exclusion are all saved", async () => {
    const { DEFAULT_DATA_SETUP } = await import("../dataSetupShared");
    const { createSetupEditQueue } = await import("../dataSetupRebase");
    const id = await fileWith({ ...DEFAULT_DATA_SETUP, accepted: true });
    const stale: DataSetup = { ...DEFAULT_DATA_SETUP, accepted: false };
    const { save, log } = await network(id);
    const queue = createSetupEditQueue(save, stale);
    const outcomes = await threeEdits(queue, stale);
    expect(outcomes.map((o) => [o.status, o.latest])).toEqual([["saved", false], ["saved", false], ["saved", true]]);
    expect(await saved(id)).toMatchObject({ accepted: true, wave: "Wave 2", waveDate: "2026-06", waveIncluded: false });
    expect(outcomes[2]).toMatchObject({ setup: { accepted: true, wave: "Wave 2", waveDate: "2026-06", waveIncluded: false } });
    expect(log.maxInFlight).toBe(1);
  });

  it("edits are sent one at a time, each expecting exactly what the previous edit saved", async () => {
    const { DEFAULT_DATA_SETUP } = await import("../dataSetupShared");
    const { createSetupEditQueue } = await import("../dataSetupRebase");
    const start: DataSetup = { ...DEFAULT_DATA_SETUP, accepted: true };
    const id = await fileWith(start);
    const { save, log } = await network(id);
    await threeEdits(createSetupEditQueue(save, start), start);
    expect(log.maxInFlight).toBe(1);
    expect(log.calls).toBe(3);
    expect(log.expected.map((e) => [e.wave, e.waveDate, e.waveIncluded])).toEqual([[null, null, true], ["Wave 2", null, true], ["Wave 2", "2026-06", true]]);
    expect(await saved(id)).toMatchObject({ wave: "Wave 2", waveDate: "2026-06", waveIncluded: false });
  });

  it("a lost response fails that edit only: reported failed, never saved; the next edit is still sent and saved", async () => {
    const { DEFAULT_DATA_SETUP } = await import("../dataSetupShared");
    const { createSetupEditQueue } = await import("../dataSetupRebase");
    const start: DataSetup = { ...DEFAULT_DATA_SETUP, accepted: true };
    const id = await fileWith(start);
    const { save } = await network(id, { failOnCall: 2 });
    const outcomes = await threeEdits(createSetupEditQueue(save, start), start);
    expect(outcomes.map((o) => o.status)).toEqual(["saved", "failed", "saved"]);
    expect(outcomes[1]).toMatchObject({ status: "failed", error: expect.stringContaining("lost") });
    // The month never reached the database; the exclusion made after it is saved onto what was saved.
    expect(await saved(id)).toMatchObject({ wave: "Wave 2", waveDate: null, waveIncluded: false });
    expect(outcomes[2]).toMatchObject({ latest: true, setup: { wave: "Wave 2", waveDate: null, waveIncluded: false } });
  });

  it("another tab: a different field saved there merges; the same field saved there is a conflict showing its value", async () => {
    const { DEFAULT_DATA_SETUP } = await import("../dataSetupShared");
    const { createSetupEditQueue } = await import("../dataSetupRebase");
    const { saveDataSetupAction } = await import("../dataSetupActions");
    const start: DataSetup = { ...DEFAULT_DATA_SETUP, accepted: true };
    const id = await fileWith(start);
    const { save } = await network(id);
    const queue = createSetupEditQueue(save, start);
    expect(await saveDataSetupAction(run, id, { ...start, wave: "Wave 2" }, { kind: "value", setup: start })).toMatchObject({ ok: true });
    expect(await queue.edit(start, { ...start, waveDate: "2026-06" })).toMatchObject({ status: "saved" });
    expect(await saved(id)).toMatchObject({ wave: "Wave 2", waveDate: "2026-06" });
    const now = await saved(id);
    expect(await saveDataSetupAction(run, id, { ...now, waveDate: "2026-07" }, { kind: "value", setup: now })).toMatchObject({ ok: true });
    expect(await queue.edit(now, { ...now, waveDate: "2026-08" })).toMatchObject({ status: "conflict", current: { waveDate: "2026-07" } });
    expect(await saved(id)).toMatchObject({ waveDate: "2026-07" });
  });

  it("an acceptance given to a structure changed meanwhile is still refused (E1-F02 through the queue)", async () => {
    const { DEFAULT_DATA_SETUP } = await import("../dataSetupShared");
    const { createSetupEditQueue } = await import("../dataSetupRebase");
    const { saveDataSetupAction } = await import("../dataSetupActions");
    const start: DataSetup = { ...DEFAULT_DATA_SETUP, accepted: false };
    const id = await fileWith(start);
    const { save } = await network(id);
    const queue = createSetupEditQueue(save, start);
    const changed = { ...start, layout: "columns_are_cases" as const };
    expect(await saveDataSetupAction(run, id, changed, { kind: "value", setup: start })).toMatchObject({ ok: true });
    expect(await queue.edit(start, { ...start, accepted: true })).toMatchObject({ status: "conflict" });
    expect(await saved(id)).toMatchObject({ layout: "columns_are_cases", accepted: false });
  });
});
