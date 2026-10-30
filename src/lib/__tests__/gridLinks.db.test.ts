// Batch 53: grid rows linked through the actual suggestInstrumentLinks and getInstrumentLinks on a real
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

for (const stoppedBefore of [null] as const) {
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

    if (!stoppedBefore) {
      it("with short data labels, the grid is found through the confirmed codebook entries' wording (the IGS case)", async () => {
        const p = await project(db, tenant);
        const one = async (sql: string, args: unknown[]) => (await db.pool.query(sql, args)).rows[0].id as string;
        // The data file's labels say nothing of the stem: only the codebook does.
        const short = { ...DICTIONARY, variables: DICTIONARY.variables.map((v) => ({ ...v, label: v.name })) };
        await db.pool.query("update documents set variable_dictionary = $1 where id = $2", [JSON.stringify(short), p.data]);
        const { runStatsTool } = await import("../parseStatsFile");
        vi.mocked(runStatsTool).mockImplementation(async (tool: string) => (tool === "dictionary" ? structuredClone(short) : { items: [] }) as never);
        try {
          const cb = await one("insert into documents (tenant_id, run_id, kind, source_filename, storage_path, instrument_type) values ($1, $2, 'instrument', 'cb.xlsx', $3, 'codebook') returning id", [tenant, p.run, randomUUID()]);
          let order = 0;
          for (const v of DICTIONARY.variables.filter((x) => /^Q5_\d$/.test(x.name))) {
            const item = await one("insert into instrument_items (tenant_id, run_id, document_id, item_order, code, item_text, response_options) values ($1, $2, $3, $4, $5, $6, '[]') returning id", [tenant, p.run, cb, ++order, v.name, v.label]);
            await db.pool.query("insert into instrument_links (tenant_id, run_id, item_id, data_document_id, variable, method, confidence, status) values ($1, $2, $3, $4, $5, 'code', 1, 'confirmed')", [tenant, p.run, item, p.data, v.name]);
          }
          const { suggestInstrumentLinks } = await import("../instruments");
          await suggestInstrumentLinks(tenant, p.run, p.questionnaire, p.data);
          expect(await linksOf(tenant, p.questionnaire, p.a)).toEqual([1, 2, 3].map((i) => [`Q5_${i}`, "grid", 0.92, "suggested"]));
          // 5B has no codebook entries here and short labels: no grid.
          expect((await linksOf(tenant, p.questionnaire, p.b)).filter((l) => l[1] === "grid")).toEqual([]);
        } finally {
          vi.mocked(runStatsTool).mockImplementation(async (tool: string) => (tool === "dictionary" ? structuredClone(DICTIONARY) : { items: [] }) as never);
        }
      });

      it("Confirm all for one question confirms its rows; a column another question already has stays a suggestion, named; other questions are untouched", async () => {
        const p = await project(db, tenant);
        const { suggestInstrumentLinks, confirmInstrumentLinks, chooseInstrumentLink } = await import("../instruments");
        await suggestInstrumentLinks(tenant, p.run, p.questionnaire, p.data);
        // The researcher has already linked Q5_2 to 5B by hand.
        await chooseInstrumentLink(tenant, p.run, p.questionnaire, p.b, p.data, "Q5_2");
        const r = await confirmInstrumentLinks(tenant, p.run, p.questionnaire, 0, p.a);
        expect(r.confirmed).toBe(2);
        expect(r.refused).toEqual([{ variable: "Q5_2", reason: expect.stringContaining("5B") }]);
        expect((await linksOf(tenant, p.questionnaire, p.a)).map((l) => [l[0], l[3]])).toEqual([["Q5_1", "confirmed"], ["Q5_2", "suggested"], ["Q5_3", "confirmed"]]);
        // 5B's own suggestions are not confirmed by 5A's action.
        expect((await linksOf(tenant, p.questionnaire, p.b)).filter((l) => l[1] === "grid").every((l) => l[3] === "suggested")).toBe(true);
        // Repeating it (a retried request) confirms nothing more.
        expect(await confirmInstrumentLinks(tenant, p.run, p.questionnaire, 0, p.a)).toMatchObject({ confirmed: 0 });
        // A question of another questionnaire confirms nothing here.
        expect(await confirmInstrumentLinks(tenant, p.run, p.questionnaire, 0, "00000000-0000-0000-0000-000000000000")).toEqual({ confirmed: 0, refused: [] });
      });

      it("Confirm all in one wave's review confirms that wave's rows only; the other wave's stay suggestions (Grant, 29 October 2026)", async () => {
        const p = await project(db, tenant);
        const wave2 = (
          await db.pool.query(
            `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup, variable_dictionary)
             values ($1, $2, 'table', 'raw', 'poll-w2.sav', $3, $4, $5) returning id`,
            [tenant, p.run, `${tenant}/${p.run}/poll-w2.sav`, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true }), JSON.stringify(DICTIONARY)],
          )
        ).rows[0].id as string;
        const { suggestInstrumentLinks, confirmInstrumentLinks, getInstrumentLinks } = await import("../instruments");
        await suggestInstrumentLinks(tenant, p.run, p.questionnaire, p.data);
        await suggestInstrumentLinks(tenant, p.run, p.questionnaire, wave2);
        const statuses = async (file: string) =>
          (await getInstrumentLinks(tenant, p.questionnaire)).filter((l) => l.itemId === p.a && l.dataDocumentId === file).map((l) => l.status);
        expect(await statuses(wave2)).toEqual(["suggested", "suggested", "suggested"]);
        expect(await confirmInstrumentLinks(tenant, p.run, p.questionnaire, 0, p.a, p.data)).toMatchObject({ confirmed: 3 });
        expect(await statuses(p.data)).toEqual(["confirmed", "confirmed", "confirmed"]);
        expect(await statuses(wave2)).toEqual(["suggested", "suggested", "suggested"]);
        // The other wave is confirmed from its own review.
        expect(await confirmInstrumentLinks(tenant, p.run, p.questionnaire, 0, p.a, wave2)).toMatchObject({ confirmed: 3 });
        expect(await statuses(wave2)).toEqual(["confirmed", "confirmed", "confirmed"]);
      });
    }
  });
}
