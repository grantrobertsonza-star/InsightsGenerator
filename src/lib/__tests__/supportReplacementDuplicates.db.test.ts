// FND-001 / REP-OUT-001 remainder: replacement and duplicate support carried to a dependent
// artifact (frozen acceptance: "in-place change, delete, replacement and duplicates
// invalidate/qualify the affected dependent artifact; unchanged support stays eligible; human
// wording survives"). Change, delete and rejection are covered elsewhere; this adds:
//   replacement  a full re-read of the report (ACTUAL extractFindingsFromDocument) that no longer
//                extracts a finding an accepted insight is built on: the finding is kept live with
//                its id and wording (REP-IN-002 protection), so the insight's support is still
//                current in the insight CSV and deck; an unprotected finding with no dependants is
//                retired; the re-read's new claim is added once.
//   duplicates   an accepted insight built on the same claim from two reports: deleting one report
//                (the app's deleteDocument) leaves the insight with fewer sources than it was built from, so
//                the CSV says its support is no longer valid and the accepted-scope deck leaves it
//                out; the insight row and its human wording survive.
//   control      an insight whose support is untouched stays "Support current" throughout.
// Real disposable PostgreSQL through the app's own db.ts and the actual export routes. Controlled:
// the model (scripted record_findings answer), storage (report text), Next's cache/after() and the
// verification chain after(), as in findingWording.db.test.ts.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

const hooks = vi.hoisted(() => ({ storageText: "", extraction: [] as Record<string, unknown>[] }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("../verifyAfterGenerate", () => ({ verifyAfterGenerate: vi.fn(async () => {}) }));
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/deckSlides", async () => await import("../deckSlides"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("@/lib/supportStatus", async () => await import("../supportStatus"));
vi.mock("@/lib/supportStatusShared", async () => await import("../supportStatusShared"));
vi.mock("@/lib/figureChecks", async () => await import("../figureChecks"));
vi.mock("@/lib/numberTrace", async () => await import("../numberTrace"));
vi.mock("@/lib/findingWording", async () => await import("../findingWording"));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../contradictionDetector", () => ({ refreshContradictions: vi.fn() }));
vi.mock("../tableComputation", () => ({ getTableGroundingDigest: vi.fn(async () => []) }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: vi.fn(async () => ({ data: { arrayBuffer: async () => Buffer.from(hooks.storageText) }, error: null })),
        upload: vi.fn(async () => ({ error: null })),
        remove: vi.fn(async () => ({ error: null })),
      }),
    },
  },
}));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  anthropic: {
    messages: {
      create: vi.fn(async () => ({
        stop_reason: "tool_use",
        usage: {},
        content: [{ type: "tool_use", id: "tu", name: "record_findings", input: { findings: hooks.extraction } }],
      })),
    },
  },
}));

vi.setConfig({ testTimeout: 60000 });
const TENANT = "00000000-0000-4000-8000-0000000000f7";

describe.skipIf(!TEST_DATABASE_URL)("replacement and duplicate support reach the insight exports (real database)", () => {
  let db: DisposableDb;
  let run = "";
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;
  const rows = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows;
  const report = (name: string) =>
    one(`insert into documents (tenant_id, run_id, kind, source_filename, storage_path) values ($1, $2, 'report', $3, $3) returning id`, [TENANT, run, name]);
  const statedFinding = (doc: string, text: string, quote: string) =>
    one(
      `insert into findings (tenant_id, run_id, origin, finding_text, finding_kind, status, theme, source_document_id, source_quote) values ($1, $2, 'stated', $3, 'fact', 'accepted', 'T', $4, $5) returning id`,
      [TENANT, run, text, doc, quote],
    );
  /** An accepted synthesized insight built on the given findings, each through its own pre-insight. */
  async function insight(headline: string, findings: string[]) {
    const si = await one(
      `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count, independent_source_count, confidence_tier, review_status)
       values ($1, $2, $3, 'Researcher wording kept', 't', 'i', $4, 1, 1, 'exploratory', 'accepted') returning id`,
      [TENANT, run, headline, findings.length],
    );
    for (const f of findings) {
      const pi = await one(`insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1, $2, $3, 'h', 'o', 't', 'i') returning id`, [TENANT, run, f]);
      await db.pool.query(`insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id, support_snapshot) values ($1, $2, $3, finding_support_parts($4))`, [TENANT, si, pi, f]);
    }
    return si;
  }
  const params = () => ({ params: Promise.resolve({ id: run }) });
  async function csvSupport() {
    const { GET } = await import("../../app/api/runs/[id]/synthesized-insights/export/route");
    const res = await GET(new Request("http://x/"), params());
    expect(res.status).toBe(200);
    const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: "array" });
    const list = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
    return Object.fromEntries(list.map((r) => [String(r.Headline), String(r.Support)]));
  }
  async function deckText(scope: string) {
    const { GET } = await import("../../app/api/runs/[id]/synthesized-insights/export-deck/route");
    const res = await GET(new Request(`http://x/?scope=${scope}`), params());
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    return (await Promise.all(names.map((n) => zip.file(n)!.async("string")))).join("\n").replace(/<[^>]+>/g, " ");
  }

  const SAT_Q = "Satisfaction stands at 72 percent among recent customers.";
  const SAT = "Satisfaction is 72% among recent customers.";
  const UNUSED_Q = "Churn runs at five percent a year.";
  const NEW_Q = "Net promoter score is 30 this year.";
  const LOY = "Loyalty is 40% among members.";
  const LOY_Q = "Loyalty stands at 40 percent among members.";
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = TENANT;
    await db.pool.query(`insert into tenants (id, name) values ($1, 'T')`, [TENANT]);
    run = await one(`insert into runs (tenant_id, project_name, entry_point) values ($1, 'Support handover', 'generate') returning id`, [TENANT]);
    ids.main = await report("main-report.txt");
    ids.sat = await statedFinding(ids.main, SAT, SAT_Q);
    ids.unused = await statedFinding(ids.main, "Churn is 5% a year.", UNUSED_Q);
    ids.reportA = await report("wave-a.txt");
    ids.reportB = await report("wave-b.txt");
    const loyA = await statedFinding(ids.reportA, LOY, LOY_Q);
    const loyB = await statedFinding(ids.reportB, LOY, LOY_Q);
    const group = (await rows("select gen_random_uuid() as g", []))[0].g;
    await db.pool.query("update findings set duplicate_group_id = $1 where id = any($2::uuid[])", [group, [loyA, loyB]]);
    const control = await statedFinding(ids.reportA, "Awareness is 60%.", "Awareness stands at 60 percent.");
    ids.satInsight = await insight("Satisfaction insight", [ids.sat]);
    ids.loyInsight = await insight("Loyalty insight", [loyA, loyB]);
    ids.control = await insight("Control insight", [control]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool?.end?.();
    await db?.drop();
  });

  it("before anything changes, every insight's support is current", async () => {
    expect(await csvSupport()).toEqual({ "Satisfaction insight": "Support current", "Loyalty insight": "Support current", "Control insight": "Support current" });
  });

  it("replacement: a re-read that drops a supporting claim keeps that finding and its insight's support current", async () => {
    hooks.storageText = `Annual report. ${NEW_Q} Nothing else of note.`;
    hooks.extraction = [{ finding_text: "NPS is 30 this year.", finding_kind: "fact", theme: "Advocacy", data_type: "quantitative", source_quote: NEW_Q }];
    const { extractFindingsFromDocument } = await import("../extractFindings");
    await extractFindingsFromDocument(TENANT, run, ids.main);
    const live = await rows("select id, finding_text from findings where source_document_id = $1 order by finding_text", [ids.main]);
    expect(live.map((r) => r.finding_text)).toEqual(["NPS is 30 this year.", SAT]);
    expect(live.find((r) => r.finding_text === SAT)!.id).toBe(ids.sat);
    expect(await rows("select id from findings where id = $1", [ids.unused])).toEqual([]);
    const support = await csvSupport();
    expect(support["Satisfaction insight"]).toBe("Support current");
    expect(support["Control insight"]).toBe("Support current");
  });

  it("duplicates: removing one of two duplicate sources marks the insight no longer valid; wording survives; control unaffected", async () => {
    // The app's own delete (findings first, then the document, then storage cleanup).
    const { deleteDocument } = await import("../documentActions");
    await deleteDocument(run, ids.reportB);
    expect(await rows("select id from documents where id = $1", [ids.reportB])).toEqual([]);
    const support = await csvSupport();
    expect(support["Loyalty insight"]).toMatch(/^Support no longer valid/);
    expect(support["Control insight"]).toBe("Support current");
    expect(support["Satisfaction insight"]).toBe("Support current");
    const kept = await rows("select headline, observation, review_status from synthesized_insights where id = $1", [ids.loyInsight]);
    expect(kept).toEqual([{ headline: "Loyalty insight", observation: "Researcher wording kept", review_status: "accepted" }]);
    const accepted = await deckText("accepted");
    expect(accepted).toMatch(/Left out: support no longer valid/);
    expect(accepted).toMatch(/Control insight/);
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("replacement and duplicate support reach the insight exports (real database)", () => { it.skip(DISPOSABLE_DB_SKIP_REASON, () => {}); });
