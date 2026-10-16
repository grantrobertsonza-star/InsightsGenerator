import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, DISPOSABLE_DB_SKIP_REASON, type DisposableDb } from "./helpers/disposableDb";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../anthropic", () => ({ anthropic: {}, CLAUDE_MODEL: "not-called" }));
describe.skipIf(!TEST_DATABASE_URL)("IMP-013 same question across document identities", () => {
  let db: DisposableDb; const tenant = randomUUID(); let run: string; const docs: string[] = [];
  beforeAll(async () => {
    db = await createDisposableDb(); process.env.DATABASE_URL = db.url; process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic identity')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id) values($1) returning id", [tenant])).rows[0].id;
    for (const name of ["wave-A.csv","wave-B.csv","wave-C.csv"]) docs.push((await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,ingestion_type) values($1,$2,'table',$3,$3,'raw') returning id", [tenant,run,name])).rows[0].id);
  }, 120000);
  afterAll(async () => { const { pool } = await import("../db"); await pool.end(); await db.drop(); });
  it("actual post/status/remove/revive callers keep q1 separate for all three documents", async () => {
    const a = await import("../chartActions");
    const result = { variable: "q1", label: "Purchase", n: 40, weighted: false, groupLabel: null, series: [{ name: "Total", n: 40, bars: [{ label: "Yes", rawCode: "1", pct: 75, count: 30 }, { label: "No", rawCode: "2", pct: 25, count: 10 }] }] } as unknown as Parameters<typeof a.addChartFindingAction>[2];
    for (const doc of docs) expect(await a.addChartFindingAction(run,doc,result,null)).toMatchObject({ ok: true, added: true });
    const rows = async () => (await db.pool.query("select id,source_document_id,finding_text,status from findings where run_id=$1 order by source_document_id", [run])).rows;
    const before = await rows(); expect(before).toHaveLength(3);
    expect(new Set(before.map(r => r.id)).size).toBe(3);
    expect(before.map(r => r.source_document_id).sort()).toEqual([...docs].sort());
    expect(await a.removeChartFindingAction(run,docs[1],"q1",null)).toMatchObject({ ok: true, removed: 1 });
    for (let i = 0; i < docs.length; i++) expect(await a.chartFindingStatusAction(run,docs[i],"q1",null)).toMatchObject({ ok: true, committed: i !== 1 });
    const untouched = before.filter(r => r.source_document_id !== docs[1]);
    expect((await rows()).filter(r => r.source_document_id !== docs[1])).toEqual(untouched);
    await a.addChartFindingAction(run,docs[1],result,null);
    expect(await rows()).toEqual(before);
    await a.addChartFindingAction(run,docs[1],result,null);
    expect(await rows()).toHaveLength(3);
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("IMP-013 same question across document identities", () => { it.skip(DISPOSABLE_DB_SKIP_REASON, () => {}); });
