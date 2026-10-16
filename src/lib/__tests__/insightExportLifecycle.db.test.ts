// FND-001 F9 + F12 and INS-001's CSV check, against a REAL PostgreSQL through the app's own db.ts.
//   F9   the actual insight CSV export carries Support (in words) and Independent sources, and the
//        actual insight deck tags changed support and leaves out invalid support (accepted scope)
//        or tags it (all scope)
//   F12  lifecycle: accept -> a source finding is edited in place -> reload -> synthesis runs again:
//        the insight's wording and acceptance are untouched, it now reads "Support changed since
//        drafted", and re-running synthesis neither rewrites nor duplicates it.
// Only the model (synthesis), storage and chart rendering are mocked.
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/deckSlides", async () => await import("../deckSlides"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("@/lib/supportStatus", async () => await import("../supportStatus"));
vi.mock("@/lib/supportStatusShared", async () => await import("../supportStatusShared"));
vi.mock("@/lib/figureChecks", async () => await import("../figureChecks"));
vi.mock("@/lib/numberTrace", async () => await import("../numberTrace"));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../contradictionDetector", () => ({ refreshContradictions: vi.fn() }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "test-model",
  // Any synthesis pass proposes nothing new: the point is what it does to EXISTING insights.
  anthropic: { messages: { create: vi.fn(async () => ({ stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", input: { clusters: [] } }] })) } },
}));

const TENANT = "00000000-0000-4000-8000-0000000000ee";

describe.skipIf(!TEST_DATABASE_URL)("insight exports and lifecycle (real database)", () => {
  let db: DisposableDb;
  let run = "";
  const ids: Record<string, string> = {};
  const one = async (sql: string, p: unknown[]) => (await db.pool.query(sql, p)).rows[0].id as string;

  async function insight(headline: string, findingTexts: string[]) {
    const pres: { f: string; pi: string }[] = [];
    for (const t of findingTexts) {
      const f = await one(`insert into findings (tenant_id, run_id, origin, finding_text, status, theme) values ($1, $2, 'stated', $3, 'accepted', 'T') returning id`, [TENANT, run, t]);
      const pi = await one(`insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1, $2, $3, 'h', 'o', 't', 'i') returning id`, [TENANT, run, f]);
      pres.push({ f, pi });
    }
    const si = await one(
      `insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, triangulation_count, source_theme_count,
                                         independent_source_count, confidence_tier, review_status)
       values ($1, $2, $3, 'o', 't', 'i', $4, 1, 1, 'exploratory', 'accepted') returning id`,
      [TENANT, run, headline, findingTexts.length],
    );
    for (const p of pres) {
      await db.pool.query(
        `insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id, support_snapshot) values ($1, $2, $3, finding_support_parts($4))`,
        [TENANT, si, p.pi, p.f],
      );
    }
    return { si, findings: pres.map((p) => p.f) };
  }

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = TENANT;
    await db.pool.query(`insert into tenants (id, name) values ($1, 'T')`, [TENANT]);
    run = await one(`insert into runs (tenant_id, project_name, entry_point) values ($1, 'Lifecycle', 'generate') returning id`, [TENANT]);
    const cur = await insight("Current insight", ["C1", "C2"]);
    const changed = await insight("Changed insight", ["S1", "S2"]);
    const invalid = await insight("Invalid insight", ["I1", "I2"]);
    ids.cur = cur.si;
    ids.changed = changed.si;
    ids.invalid = invalid.si;
    await db.pool.query(`update findings set finding_text = 'S1 reworded by a rerun' where id = $1`, [changed.findings[0]]);
    await db.pool.query(`update findings set status = 'rejected' where id = $1`, [invalid.findings[0]]);
  }, 120000);

  afterAll(async () => {
    const { pool } = await import("../db");
    await pool?.end?.();
    await db?.drop();
  });

  const params = () => ({ params: Promise.resolve({ id: run }) });

  it("F9: the insight CSV states Support in words and Independent sources", async () => {
    const { GET } = await import("../../app/api/runs/[id]/synthesized-insights/export/route");
    const res = await GET(new Request("http://x/"), params());
    expect(res.status).toBe(200);
    const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
    const by = (h: string) => rows.find((r) => r.Headline === h)!;
    expect(by("Current insight").Support).toBe("Support current");
    expect(String(by("Changed insight").Support)).toMatch(/^Support changed since drafted: the wording of/);
    expect(String(by("Invalid insight").Support)).toMatch(/^Support no longer valid: .* was rejected/);
    expect(by("Current insight")["Independent sources"]).toBe(1);
    expect(by("Current insight")["Linked pre-insights"]).toBe(2);
  });

  it("F9: the insight deck tags changed support, and leaves out (accepted) or tags (all) invalid support", async () => {
    const { GET } = await import("../../app/api/runs/[id]/synthesized-insights/export-deck/route");
    const text = async (scope: string) => {
      const res = await GET(new Request(`http://x/?scope=${scope}`), params());
      const zip = await JSZip.loadAsync(await res.arrayBuffer());
      const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
      return (await Promise.all(names.map((n) => zip.file(n)!.async("string")))).join("\n").replace(/<[^>]+>/g, " ");
    };
    const accepted = await text("accepted");
    expect(accepted).toMatch(/SUPPORT CHANGED/);
    expect(accepted).toMatch(/Left out: support no longer valid/);
    const all = await text("all");
    expect(all).toMatch(/SUPPORT NO LONGER VALID/);
  });

  it("F12: accept -> source changed -> reload -> synthesis again: wording and decision intact, status changed, nothing rewritten or duplicated", async () => {
    const before = (await db.pool.query(`select id, headline, observation, review_status from synthesized_insights where run_id = $1 order by id`, [run])).rows;
    const { synthesizeInsights } = await import("../insightSynthesizer");
    await synthesizeInsights(TENANT, run);
    const after = (await db.pool.query(`select id, headline, observation, review_status from synthesized_insights where run_id = $1 order by id`, [run])).rows;
    expect(after).toEqual(before);
    const { loadInsightSupport } = await import("../supportStatus");
    const s = await loadInsightSupport(TENANT, run);
    expect(s.statusOf(ids.changed).status).toBe("stale");
    expect(s.statusOf(ids.invalid).status).toBe("invalid");
    expect(s.statusOf(ids.cur).status).toBe("current");
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("insight exports and lifecycle (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
