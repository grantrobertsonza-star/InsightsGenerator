// Batch 53, before migration 0130 (the same project as gridLinks.db.test.ts): grid rows linked through the actual suggestInstrumentLinks and getInstrumentLinks on a real
// disposable PostgreSQL, with migration 0130 and on one stopped before it. The data file's labels are the
// IGS codebook's form (stem, note, dash, row); the questionnaire's codes (5A, 5B) differ from the columns'.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

const { DICTIONARY, STEM_A, STEM_B } = vi.hoisted(() => {
  const STEM_A = "Regardless of whom you supported for Governor, is your opinion of each of the top candidates generally favorable or unfavorable, or do you not know enough about them to say?";
  const STEM_B = "Regardless of whom you will support for Governor, is your opinion of each of the top candidates generally favorable or unfavorable, or do you not know enough about them to say?";
  const rows = ["Tony Thurmond", "Antonio Villaraigosa", "Xavier Becerra"];
  const scale = { "1": "Favorable", "2": "Unfavorable", "3": "Don't know" };
  const variables = [
    ...rows.map((r, i) => ({ name: `Q5_${i + 1}`, label: `Q5_${i + 1} ${STEM_A} (already voted) – ${r}`, numeric: true, valueLabels: scale })),
    ...rows.map((r, i) => ({ name: `Q5b_${i + 1}`, label: `Q5b_${i + 1} ${STEM_B} (planning to vote) – ${r}`, numeric: true, valueLabels: scale })),
    ...rows.map((_, i) => ({ name: `Q5_${i + 1}_summary`, label: `Q5_${i + 1} (summary) Combines Q5_${i + 1} and Q5b_${i + 1}`, numeric: true, valueLabels: scale })),
  ];
  return { STEM_A, STEM_B, DICTIONARY: { version: 14, layout: "rows_are_cases", nCases: 40, variables } };
});
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: { storage: { from: vi.fn() } } }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "synthetic", anthropic: { messages: { create: vi.fn(async () => { throw new Error("test: no model call expected"); }) } } }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../parseStatsFile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../parseStatsFile")>()),
  runStatsTool: vi.fn(async (tool: string) => (tool === "dictionary" ? structuredClone(DICTIONARY) : { items: [] })),
}));

async function project(db: DisposableDb, tenant: string) {
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;
  const run = await one("insert into runs (tenant_id, project_name) values ($1, 'Poll') returning id", [tenant]);
  const data = await one(
    `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup, variable_dictionary)
     values ($1, $2, 'table', 'raw', 'poll.sav', $3, $4, $5) returning id`,
    [tenant, run, `${tenant}/${run}/poll.sav`, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true }), JSON.stringify(DICTIONARY)],
  );
  const questionnaire = await one("insert into documents (tenant_id, run_id, kind, source_filename, storage_path, instrument_type) values ($1, $2, 'instrument', 'q.docx', $3, 'questionnaire') returning id", [tenant, run, randomUUID()]);
  const item = (order: number, code: string, text: string) =>
    one("insert into instrument_items (tenant_id, run_id, document_id, item_order, code, item_text, response_options) values ($1, $2, $3, $4, $5, $6, '[]') returning id", [tenant, run, questionnaire, order, code, text]);
  const a = await item(1, "5A", `${STEM_A}\na. Tony Thurmond\nb. Antonio Villaraigosa\nc. Xavier Becerra`);
  const b = await item(2, "5B", STEM_B);
  return { run, data, questionnaire, a, b };
}

const linksOf = async (tenant: string, doc: string, item: string) => {
  const { getInstrumentLinks } = await import("../instruments");
  return (await getInstrumentLinks(tenant, doc)).filter((l) => l.itemId === item).map((l) => [l.variable, l.method, l.confidence, l.status]).sort();
};

for (const stoppedBefore of ["0130"] as const) {
  describe.skipIf(!TEST_DATABASE_URL)(`grid rows ${stoppedBefore ? "before migration 0130" : "with migration 0130"} (real database)`, () => {
    let db: DisposableDb;
    const tenant = randomUUID();
    beforeAll(async () => {
      db = await (stoppedBefore ? createDisposableDb(stoppedBefore) : createDisposableDb());
      await db.pool.query("insert into tenants (id, name) values ($1, 'T')", [tenant]);
      (globalThis as { pgPool?: unknown }).pgPool = undefined;
      process.env.DATABASE_URL = db.url;
    }, 180_000);
    afterAll(async () => {
      const { pool } = await import("../db");
      await pool.end().catch(() => {});
      (globalThis as { pgPool?: unknown }).pgPool = undefined;
      await db?.drop();
    });

    it(stoppedBefore ? "no grid link is made; matching works as before" : "5A is linked to Q5_1..3 and 5B to Q5b_1..3 as grid rows; the summaries are not; a second match changes nothing", async () => {
      const p = await project(db, tenant);
      const { suggestInstrumentLinks } = await import("../instruments");
      await suggestInstrumentLinks(tenant, p.run, p.questionnaire, p.data);
      const a = await linksOf(tenant, p.questionnaire, p.a);
      const b = await linksOf(tenant, p.questionnaire, p.b);
      if (stoppedBefore) {
        expect([...a, ...b].some((l) => l[1] === "grid")).toBe(false);
        return;
      }
      expect(a).toEqual([1, 2, 3].map((i) => [`Q5_${i}`, "grid", 0.92, "suggested"]));
      expect(b).toEqual([1, 2, 3].map((i) => [`Q5b_${i}`, "grid", 0.92, "suggested"]));
      await suggestInstrumentLinks(tenant, p.run, p.questionnaire, p.data);
      expect(await linksOf(tenant, p.questionnaire, p.a)).toEqual(a);
    });
  });
}
