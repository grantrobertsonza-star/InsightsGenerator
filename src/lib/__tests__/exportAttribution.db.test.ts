// Golden-thread repair (export attribution), against a REAL PostgreSQL through the app's own db.ts
// (DATABASE_URL pointed at a disposable database). The actual route handlers run end to end: the
// accepted-findings deck, the findings spreadsheet, the synthesized-insights deck and the
// pre-insights deck. Each exported claim must carry a traceable source; an unrecorded source is
// said in words, never left blank.
// Generic contract, not tied to any dataset:
//   - a finding read from a document names that file (and page when recorded)
//   - a finding computed from a table names the DATA FILE behind it (source_table_id points at
//     document_tables; the spreadsheet used to join documents on it directly and export a blank)
//   - an insight names the distinct sources of the findings it was built from
// Not established: visual layout of the cards (no Office rendering available here).
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/deckSlides", async () => await import("../deckSlides"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("@/lib/preInsightDeckEligibility", async () => await import("../preInsightDeckEligibility"));
vi.mock("@/lib/findingWording", async () => await import("../findingWording"));
vi.mock("@/lib/supportStatus", async () => await import("../supportStatus"));
vi.mock("@/lib/supportStatusShared", async () => await import("../supportStatusShared"));
vi.mock("@/lib/figureChecks", async () => await import("../figureChecks"));
vi.mock("@/lib/numberTrace", async () => await import("../numberTrace"));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} })); // storage client, not used by these routes

const TENANT = "00000000-0000-4000-8000-0000000000aa";

async function pptxText(res: Response): Promise<string> {
  expect(res.status).toBe(200);
  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const xml = await Promise.all(names.map((n) => zip.file(n)!.async("string")));
  return xml.map((x) => x.replace(/<\/a:p>/g, "\n").replace(/<[^>]+>/g, "")).join("\n").replace(/&amp;/g, "&");
}

describe.skipIf(!TEST_DATABASE_URL)("export source attribution (real database, actual routes)", () => {
  let db: DisposableDb;
  let run = "";
  const params = () => ({ params: Promise.resolve({ id: run }) });

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = TENANT;
    const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;
    await db.pool.query(`insert into tenants (id, name) values ($1, 'T')`, [TENANT]);
    run = await one(`insert into runs (tenant_id, project_name) values ($1, 'Attribution') returning id`, [TENANT]);
    const doc = (kind: string, name: string) =>
      one(
        `insert into documents (tenant_id, run_id, kind, source_filename, storage_path, ingestion_type)
         values ($1, $2, $3, $4, $4, case when $3 = 'table' then 'raw' end) returning id`,
        [TENANT, run, kind, name],
      );
    const report = await doc("report", "report.docx");
    const data = await doc("table", "survey.xlsx");
    const table = await one(
      `insert into document_tables (tenant_id, run_id, document_id, table_index, ingestion_type) values ($1, $2, $3, 0, 'raw') returning id`,
      [TENANT, run, data],
    );
    const finding = (origin: string, text: string, theme: string, docId: string | null, tableId: string | null, page: number | null) =>
      one(
        `insert into findings (tenant_id, run_id, origin, finding_text, status, theme, source_document_id, source_table_id, source_page)
         values ($1, $2, $3, $4, 'accepted', $5, $6, $7, $8) returning id`,
        [TENANT, run, origin, text, theme, docId, tableId, page],
      );
    const fStated = await finding("stated", "The report says purchase is 50%.", "Purchase", report, null, 2);
    const fComputed = await finding("generated", "Purchase is 50% (base 200).", "Purchase", null, table, null);
    await finding("generated", "A finding with no recorded source.", "Other", null, null, null);
    const pre = async (f: string, h: string) => {
      const id = await one(
        `insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1, $2, $3, $4, 'o', 't', 'Act on it') returning id`,
        [TENANT, run, f, h],
      );
      await db.pool.query(
        `insert into verdicts (tenant_id, finding_id, verdict_tier, rationale, statistical_checks, verification_method, corroboration_level, due_care)
         values ($1, $2, 'robust', 'r', '{}', 'single_pass', 'single_source', '{}')`,
        [TENANT, f],
      );
      return id;
    };
    const p1 = await pre(fStated, "Stated pre-insight");
    const p2 = await pre(fComputed, "Computed pre-insight");
    const si = await one(
      `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count)
       values ($1, $2, 'Half of customers buy', 'o', 't', 'Act on it', 2, 1) returning id`,
      [TENANT, run],
    );
    for (const p of [p1, p2]) {
      await db.pool.query(`insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id) values ($1, $2, $3)`, [TENANT, si, p]);
    }
  }, 120000);

  afterAll(async () => {
    const { pool } = await import("../db");
    await pool?.end?.();
    await db?.drop();
  });

  it("accepted-findings deck: each card names its source; an unrecorded one says so", async () => {
    const { GET } = await import("../../app/api/runs/[id]/findings/export-deck/route");
    const text = await pptxText(await GET(new Request("http://x/?scope=accepted"), params()));
    expect(text).toContain("Source: report.docx, p. 2");
    expect(text).toContain("Source: survey.xlsx");
    expect(text).toContain("Source not recorded");
  });

  it("findings spreadsheet: a computed finding's Source is its data file, not blank", async () => {
    const { GET } = await import("../../app/api/runs/[id]/findings/export/route");
    const res = await GET(new Request("http://x/"), params());
    expect(res.status).toBe(200);
    const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
    const byText = (t: string) => rows.find((r) => Object.values(r).includes(t))!;
    expect(byText("Purchase is 50% (base 200).").Source).toBe("survey.xlsx");
    expect(byText("The report says purchase is 50%.")).toMatchObject({ Source: "report.docx", Page: 2 });
    expect(byText("A finding with no recorded source.").Source).toBe("Source not recorded");
  });

  it("synthesized-insights deck: an insight names the distinct sources of its evidence", async () => {
    const { GET } = await import("../../app/api/runs/[id]/synthesized-insights/export-deck/route");
    const text = await pptxText(await GET(new Request("http://x/?scope=accepted"), params()));
    expect(text).toContain("Half of customers buy");
    expect(text).toMatch(/Sources: (report\.docx, p\. 2; survey\.xlsx|survey\.xlsx; report\.docx, p\. 2)/);
  });

  it("pre-insights deck: each insight names its finding's source", async () => {
    const { GET } = await import("../../app/api/runs/[id]/insights/export-deck/route");
    const text = await pptxText(await GET(new Request("http://x/"), params()));
    expect(text).toContain("Source: report.docx, p. 2");
    expect(text).toContain("Source: survey.xlsx");
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("export source attribution (real database, actual routes)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
