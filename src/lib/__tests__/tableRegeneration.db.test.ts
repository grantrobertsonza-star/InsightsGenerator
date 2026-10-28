// EF-FND-F03 (batch 62): computing a table's findings again keeps the researcher's work. Through the
// real generateFindingsFromTable / generateFindingsFromBannerPlan, the shared publication rule
// (tableFindingPublication.ts with planReplacement from findingReplacement.ts), the real researcher
// actions (findingActions.ts) and the real archive, against a real disposable PostgreSQL, connected as
// a role without row-level-security bypass. The model is never called (mocked to fail if it is).
//
// Covered: an unchanged retry keeps every finding's id with its note, theme, status and edits, and
// adds nothing; a rejected finding is not brought back; dependent links (an insight, a report finding
// grounded on it) survive; a source change keeps an annotated finding on its old figures, tagged as
// superseded and linked to the new computed finding, while an untouched one is replaced and archived;
// a comparison that no longer yields a finding is kept and tagged when annotated; a failure part way
// through rolls everything back and a retry then succeeds; the support fingerprint of a superseded
// finding changes, so work built on it reads as stale; findings from before review tracking
// withhold the replacement with a message; the banner-plan route follows the same rule; and the
// replaced rows reach finding_history.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "none", anthropic: { messages: { create: vi.fn(async () => { throw new Error("no model call expected"); }) } } }));
vi.mock("../verifyAfterGenerate", () => ({ verifyAfterGenerate: vi.fn(async () => {}) }));
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

type Row = Record<string, string | number | null>;
const rowsFor = (slope: number, n = 40): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    Region: i % 2 ? "North" : "South",
    X: i,
    Y: i * slope + 7 + ((i % 3) - 1) / 10,
    W: i * 2 + ((i % 4) - 1.5) / 10,
    S: (i % 2 ? 10 : 20) + (i % 5),
  }));

describe.skipIf(!TEST_DATABASE_URL)("table findings computed again (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  const role = "table_regen_" + randomUUID().replaceAll("-", "");
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  beforeAll(async () => {
    db = await createDisposableDb();
    await q(`create role ${role} login nosuperuser nobypassrls`);
    for (const g of [
      "grant usage on schema public to ",
      "grant select, insert, update, delete on all tables in schema public to ",
      "grant usage, select on all sequences in schema public to ",
      "grant execute on all functions in schema public to ",
    ])
      await q(g + role);
    const u = new URL(db.url);
    u.username = role;
    process.env.DATABASE_URL = u.toString();
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T')", [tenant]);
  });
  afterAll(async () => {
    const { pool, claimPool } = await import("../db");
    await pool.end().catch(() => {});
    await claimPool.end().catch(() => {});
    await q(`drop owned by ${role}`);
    await q(`drop role ${role}`);
    await db?.drop();
  });

  async function table(rows: Row[], ingestion: "aggregated" | "raw" = "aggregated") {
    const run = (await q("insert into runs (tenant_id) values ($1) returning id", [tenant]))[0].id as string;
    const doc = (await q(
      "insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path) values ($1, $2, 'table', $3, 'data.xlsx', 'synthetic') returning id",
      [tenant, run, ingestion],
    ))[0].id as string;
    const tableId = (await q(
      "insert into document_tables (tenant_id, run_id, document_id, table_index, label, headers, rows, ingestion_type) values ($1, $2, $3, 0, 'Table 1', $4, $5, $6) returning id",
      [tenant, run, doc, JSON.stringify(Object.keys(rows[0])), JSON.stringify(rows), ingestion],
    ))[0].id as string;
    return { run, doc, tableId };
  }
  const findings = (run: string) =>
    q("select id, finding_text, theme, status, researcher_note, pattern_type, stated_stats from findings where run_id = $1 order by created_at, id", [run]);
  const xy = <T extends { stated_stats: Record<string, unknown>; pattern_type: string }>(rows: T[]) =>
    rows.filter((r) => r.pattern_type === "relationship" && r.stated_stats.variable1 === "X" && r.stated_stats.variable2 === "Y");

  it("an unchanged retry keeps ids, note, theme and status, adds nothing, and does not bring back a rejection", async () => {
    const { run, tableId } = await table(rowsFor(3));
    const { generateFindingsFromTable } = await import("../generateFindingsFromTable");
    const { setFindingNote, setFindingTheme, setFindingStatus } = await import("../findingActions");
    await generateFindingsFromTable(tenant, run, tableId);
    const before = await findings(run);
    expect(before.length).toBeGreaterThan(1);
    const [noted, rejected] = before;
    expect((await setFindingNote(run, noted.id, "Interpretation A")).ok).toBe(true);
    expect((await setFindingTheme(run, noted.id, "Researcher theme")).ok).toBe(true);
    expect((await setFindingStatus(run, rejected.id, "rejected")).ok).toBe(true);
    const result = await generateFindingsFromTable(tenant, run, tableId);
    const after = await findings(run);
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after.find((r) => r.id === noted.id)).toMatchObject({ researcher_note: "Interpretation A", theme: "Researcher theme" });
    expect(after.find((r) => r.id === rejected.id)?.status).toBe("rejected");
    expect(result.publication).toMatchObject({ inserted: 0, retired: 0, keptAndTagged: 0 });
    // Retrying once more is still a no-op.
    await generateFindingsFromTable(tenant, run, tableId);
    expect((await findings(run)).map((r) => r.id)).toEqual(before.map((r) => r.id));
  });

  it("dependent links survive an unchanged retry: an insight and a report finding grounded on it", async () => {
    const { run, tableId } = await table(rowsFor(3));
    const { generateFindingsFromTable } = await import("../generateFindingsFromTable");
    await generateFindingsFromTable(tenant, run, tableId);
    const [withInsight, grounding] = await findings(run);
    const insight = (await q(
      "insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1, $2, $3, 'h', 'o', 't', 'i') returning id",
      [tenant, run, withInsight.id],
    ))[0].id;
    const report = (await q("insert into documents (tenant_id, run_id, kind, source_filename, storage_path) values ($1, $2, 'report', 'r.pdf', 's') returning id", [tenant, run]))[0].id;
    const stated = (await q(
      "insert into findings (tenant_id, run_id, origin, finding_text, source_document_id, status, grounded_by_finding_id) values ($1, $2, 'stated', 'Report says so.', $3, 'accepted', $4) returning id",
      [tenant, run, report, grounding.id],
    ))[0].id;
    await generateFindingsFromTable(tenant, run, tableId);
    expect(await q("select finding_id from insights where id = $1", [insight])).toEqual([{ finding_id: withInsight.id }]);
    expect(await q("select grounded_by_finding_id from findings where id = $1", [stated])).toEqual([{ grounded_by_finding_id: grounding.id }]);
  });

  it("a source change: the annotated finding keeps its old figures and is tagged superseded; the untouched one is replaced and archived", async () => {
    const { run, tableId } = await table(rowsFor(3));
    const { generateFindingsFromTable } = await import("../generateFindingsFromTable");
    const { setFindingNote } = await import("../findingActions");
    await generateFindingsFromTable(tenant, run, tableId);
    const before = await findings(run);
    const old = xy(before)[0];
    const untouched = before.find((r) => r.pattern_type === "relationship" && r.stated_stats.variable1 === "Y" && r.stated_stats.variable2 === "W")!;
    expect(untouched).toBeDefined();
    expect((await setFindingNote(run, old.id, "Strong link, worth acting on")).ok).toBe(true);
    const supportBefore = (await q("select finding_support_parts($1) as p", [old.id]))[0].p;
    await q("update document_tables set rows = $1 where id = $2", [JSON.stringify(rowsFor(-2)), tableId]);
    const result = await generateFindingsFromTable(tenant, run, tableId);
    const after = await findings(run);
    const kept = after.find((r) => r.id === old.id)!;
    expect(kept.finding_text).toBe(old.finding_text);
    expect(kept.researcher_note).toBe("Strong link, worth acting on");
    expect(kept.stated_stats.r).toBe(old.stated_stats.r);
    expect(kept.stated_stats.caveats).toContain("superseded_by_recomputation");
    const successor = after.find((r) => r.id === kept.stated_stats.supersededByFindingId)!;
    expect(successor.researcher_note).toBeNull();
    expect(successor.stated_stats.r).toBeLessThan(0);
    expect(xy(after)).toHaveLength(2);
    expect(after.some((r) => r.id === untouched.id)).toBe(false);
    expect(await q("select original_finding_id from finding_history where original_finding_id = $1", [untouched.id])).toHaveLength(1);
    expect(result.publication!.keptAndTagged).toBe(1);
    // Downstream freshness: the support fingerprint an insight records (migration 0096) changes with the
    // tag, so an insight or recommendation built on the kept finding reads as stale, not current.
    const supportAfter = (await q("select finding_support_parts($1) as p", [old.id]))[0].p;
    expect(supportAfter.figures).not.toBe(supportBefore.figures);
    expect(supportAfter.wording).toBe(supportBefore.wording);
  });

  it("a comparison that no longer yields a finding: annotated one kept and tagged not reproduced", async () => {
    const { run, tableId } = await table(rowsFor(3));
    const { generateFindingsFromTable } = await import("../generateFindingsFromTable");
    const { setFindingStatus } = await import("../findingActions");
    await generateFindingsFromTable(tenant, run, tableId);
    const old = xy(await findings(run))[0];
    expect((await setFindingStatus(run, old.id, "accepted")).ok).toBe(true);
    const flat = rowsFor(3).map((r, i) => ({ ...r, Y: (i * 7) % 5 }));
    await q("update document_tables set rows = $1 where id = $2", [JSON.stringify(flat), tableId]);
    await generateFindingsFromTable(tenant, run, tableId);
    const kept = (await findings(run)).find((r) => r.id === old.id)!;
    expect(kept.stated_stats.caveats).toContain("not_reproduced_on_recomputation");
    expect(kept.stated_stats.supersededByFindingId).toBeUndefined();
    // The data goes back: the finding is reproduced word for word, and the tag is cleared.
    await q("update document_tables set rows = $1 where id = $2", [JSON.stringify(rowsFor(3)), tableId]);
    await generateFindingsFromTable(tenant, run, tableId);
    const back = (await findings(run)).find((r) => r.id === old.id)!;
    expect(back.stated_stats.caveats).not.toContain("not_reproduced_on_recomputation");
  });

  it("a failure part way through rolls back everything; a retry then succeeds", async () => {
    const { run, tableId } = await table(rowsFor(3));
    const { generateFindingsFromTable } = await import("../generateFindingsFromTable");
    await generateFindingsFromTable(tenant, run, tableId);
    const before = await findings(run);
    await q("update document_tables set rows = $1 where id = $2", [JSON.stringify(rowsFor(-2)), tableId]);
    const fn = "fail_" + randomUUID().replaceAll("-", "");
    await q(`create function ${fn}() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$`);
    await q(`create trigger ${fn} before insert on findings for each row when (new.run_id = '${run}'::uuid) execute function ${fn}()`);
    try {
      await expect(generateFindingsFromTable(tenant, run, tableId)).rejects.toThrow(/injected failure/);
    } finally {
      await q(`drop trigger ${fn} on findings; drop function ${fn}()`);
    }
    expect(await findings(run)).toEqual(before);
    expect(await q("select 1 from finding_history where run_id = $1", [run])).toHaveLength(0);
    await generateFindingsFromTable(tenant, run, tableId);
    expect(xy(await findings(run))[0].stated_stats.r).toBeLessThan(0);
  });

  it("findings from before review tracking withhold the replacement with a message", async () => {
    const { run, tableId } = await table(rowsFor(3));
    const { generateFindingsFromTable } = await import("../generateFindingsFromTable");
    await generateFindingsFromTable(tenant, run, tableId);
    await q("update findings set provenance_tracked = false where run_id = $1", [run]);
    const before = await findings(run);
    await q("update document_tables set rows = $1 where id = $2", [JSON.stringify(rowsFor(-2)), tableId]);
    await expect(generateFindingsFromTable(tenant, run, tableId)).rejects.toThrow(/predates? review tracking.*Nothing was replaced/);
    expect(await findings(run)).toEqual(before);
  });

  it("a table of another project is refused and nothing changes", async () => {
    const a = await table(rowsFor(3));
    const b = await table(rowsFor(3));
    const { generateFindingsFromTable } = await import("../generateFindingsFromTable");
    await expect(generateFindingsFromTable(tenant, b.run, a.tableId)).rejects.toThrow();
    expect(await findings(b.run)).toHaveLength(0);
    expect(await findings(a.run)).toHaveLength(0);
  });

  it("the banner-plan route keeps a noted finding on an unchanged retry", async () => {
    const { run, tableId } = await table(rowsFor(3), "raw");
    await q("update document_tables set banner_columns = $1, stub_columns = $2 where id = $3", [JSON.stringify(["Region"]), JSON.stringify(["S"]), tableId]);
    const { generateFindingsFromBannerPlan } = await import("../generateFindingsFromBannerPlan");
    const { setFindingNote } = await import("../findingActions");
    await generateFindingsFromBannerPlan(tenant, run, tableId);
    const before = await findings(run);
    expect(before.length).toBeGreaterThan(0);
    expect((await setFindingNote(run, before[0].id, "Banner note")).ok).toBe(true);
    await generateFindingsFromBannerPlan(tenant, run, tableId);
    const after = await findings(run);
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after[0].researcher_note).toBe("Banner note");
  });
});
