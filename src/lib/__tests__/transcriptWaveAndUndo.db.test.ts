// Transcript wave and Undo accept on the Import screen (Grant, 2026-10-19), through the actual
// functions against a real disposable database with every migration applied (0107 included), then
// with 0107's columns removed to check the app says what it needs instead of failing or pretending.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

describe.skipIf(!TEST_DATABASE_URL)("transcript wave and Undo accept (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string, other: string;
  const transcript = async (r: string, name: string) =>
    (await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path) values($1,$2,'transcript',$3,$4) returning id", [tenant, r, name, `${tenant}/${r}/${name}`])).rows[0].id as string;
  const lib = () => import("../transcriptSetup");
  const base = { sessionType: "focus_group" as const, mode: "auto" as const, style: null };
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic transcripts')", [tenant]);
    [run, other] = (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'A'),($1,'B') returning id", [tenant])).rows.map((r) => r.id);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  it("a wave is saved with the set-up, kept by a later save that leaves it out, and cleared by a blank", async () => {
    const { saveTranscriptSetup, getTranscriptSetups, transcriptWaveAvailable } = await lib();
    expect(await transcriptWaveAvailable(tenant)).toBe(true);
    const id = await transcript(run, "groups-wave1.docx");
    await saveTranscriptSetup(tenant, run, id, { ...base, wave: "  Wave 1  " });
    expect((await getTranscriptSetups(tenant, run)).get(id)).toMatchObject({ confirmed: true, wave: "Wave 1", withdrawn: false });
    await saveTranscriptSetup(tenant, run, id, { ...base, mode: "auto" });
    expect((await getTranscriptSetups(tenant, run)).get(id)?.wave).toBe("Wave 1");
    await saveTranscriptSetup(tenant, run, id, { ...base, wave: "   " });
    expect((await getTranscriptSetups(tenant, run)).get(id)?.wave).toBeNull();
  });

  it("Undo accept keeps the choices, marks it withdrawn and held back from coding; accepting again clears that", async () => {
    const { saveTranscriptSetup, getTranscriptSetups, withdrawTranscriptSetup, findUnconfirmedTranscripts } = await lib();
    const id = await transcript(run, "interviews.docx");
    await saveTranscriptSetup(tenant, run, id, { ...base, wave: "Baseline" });
    await withdrawTranscriptSetup(tenant, run, id);
    expect((await getTranscriptSetups(tenant, run)).get(id)).toMatchObject({ confirmed: false, withdrawn: true, sessionType: "focus_group", wave: "Baseline" });
    expect((await findUnconfirmedTranscripts(tenant, run)).map((t) => t.id)).toContain(id);
    // Nothing left to undo: refused, not silently accepted.
    await expect(withdrawTranscriptSetup(tenant, run, id)).rejects.toThrow(/nothing to undo/);
    await saveTranscriptSetup(tenant, run, id, base);
    expect((await getTranscriptSetups(tenant, run)).get(id)).toMatchObject({ confirmed: true, withdrawn: false, wave: "Baseline" });
    expect((await findUnconfirmedTranscripts(tenant, run)).map((t) => t.id)).not.toContain(id);
  });

  it("a row coding created without a confirmation is not withdrawn, so the card may still accept it by itself", async () => {
    const { getTranscriptSetups } = await lib();
    const id = await transcript(run, "coded-first.docx");
    await db.pool.query("insert into coding_document_settings(tenant_id,run_id,document_id) values($1,$2,$3)", [tenant, run, id]);
    expect((await getTranscriptSetups(tenant, run)).get(id)).toMatchObject({ confirmed: false, withdrawn: false });
  });

  it("another project's transcript cannot be un-accepted from this one", async () => {
    const { saveTranscriptSetup, withdrawTranscriptSetup, getTranscriptSetups } = await lib();
    const id = await transcript(other, "elsewhere.docx");
    await saveTranscriptSetup(tenant, other, id, base);
    await expect(withdrawTranscriptSetup(tenant, run, id)).rejects.toThrow(/not accepted in this project/);
    expect((await getTranscriptSetups(tenant, other)).get(id)?.confirmed).toBe(true);
  });

  it("without migration 0107: the other choices still save, and the wave and Undo accept say what they need", async () => {
    const { saveTranscriptSetup, withdrawTranscriptSetup, getTranscriptSetups, transcriptWaveAvailable } = await lib();
    await db.pool.query("alter table coding_document_settings drop column wave, drop column setup_withdrawn_at");
    expect(await transcriptWaveAvailable(tenant)).toBe(false);
    const id = await transcript(run, "old-schema.docx");
    await saveTranscriptSetup(tenant, run, id, base);
    await expect(saveTranscriptSetup(tenant, run, id, { ...base, sessionType: "individual", wave: "Wave 2" })).rejects.toThrow(/wave needs database migration 0107\. The other choices were saved/);
    expect((await getTranscriptSetups(tenant, run)).get(id)).toMatchObject({ sessionType: "individual", confirmed: true, wave: null, withdrawn: false });
    await expect(withdrawTranscriptSetup(tenant, run, id)).rejects.toThrow(/needs database migration 0107\. Nothing was changed/);
    expect((await getTranscriptSetups(tenant, run)).get(id)?.confirmed).toBe(true);
  });
});
