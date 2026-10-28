// Batch 64, Codex EC10K-P01 (measured): the Word export ran 53/97/152/262/482 SQL statements for 1/5/10/20/40
// accepted recommendations; each evidence trail read the served decisions (with the project's accepted
// decisions and decision statement) and the project's brief passages again. The export now hands the
// recommendations to loadTrailContext, which reads those once with the bulk decision reader. This test
// measures the statements of the ACTUAL Word and Slides routes on real disposable PostgreSQL, checks every
// trail is identical to one read on its own (same qualifications), and that a failed shared read is
// stated on every trail and recovers on the next export.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { insertSupportedInsight } from "./helpers/supportedInsight";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/methodologyStatus", async () => await import("../methodologyStatus"));
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/deckSlides", async () => await import("../deckSlides"));
vi.mock("@/lib/discoverySlides", async () => await import("../discoverySlides"));
vi.mock("@/lib/findingsChartData", async () => await import("../findingsChartData"));
vi.mock("@/lib/storyNarrative", async () => await import("../storyNarrative"));
vi.mock("@/lib/docxReport", async () => await import("../docxReport"));
vi.mock("@/lib/narrativeFreshness", async () => await import("../narrativeFreshness"));
vi.mock("@/lib/evidenceTrail", async () => await import("../evidenceTrail"));
vi.mock("@/lib/evidenceTrailSlides", async () => await import("../evidenceTrailSlides"));
vi.mock("@/lib/objectiveCoverage", async () => await import("../objectiveCoverage"));
vi.mock("@/lib/caveatLabels", async () => await import("../caveatLabels"));
vi.mock("@/lib/supportStatus", async () => await import("../supportStatus"));
vi.mock("@/lib/supportStatusShared", async () => await import("../supportStatusShared"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("@/lib/narrativeSupportSummary", async () => await import("../narrativeSupportSummary"));
vi.mock("@/lib/discoveryReport", async () => ({
  ...(await import("../discoveryReport")),
  loadDiscoveryReportData: vi.fn(async () => ({ inputState: "complete", netNewSources: [], verificationNote: null, netNewInsights: [], netNewFindings: [], netNewFindingsOmitted: 0, contradictions: [] })),
}));
vi.mock("@/lib/exportChartImages", () => ({ buildChartImagesByTheme: vi.fn(async () => []) }));
vi.mock("@/lib/figureChecks", async () => await import("../figureChecks"));
vi.mock("@/lib/numberTrace", async () => await import("../numberTrace"));
vi.mock("@/lib/latestVerdict", async () => await import("../latestVerdict"));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
const control = vi.hoisted(() => ({ insights: 0, failPassages: false }));
// The shared read's failure, injected at the brief passage reader.
vi.mock("../briefPassages", async (orig) => {
  const real = await orig<typeof import("../briefPassages")>();
  return {
    ...real,
    loadBriefPassages: async (...args: Parameters<typeof real.loadBriefPassages>) => {
      if (control.failPassages) throw new Error("injected passage read failure");
      return real.loadBriefPassages(...args);
    },
  };
});
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "controlled",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { tool_choice?: { name?: string } }) => {
        const name = req.tool_choice?.name;
        if (name !== "record_validations") throw new Error(`unexpected tool ${name}`);
        const input = { validations: [0, 1].map((item_index) => ({ item_index, status: "partial", conclusion: "The service evidence informs it.", insight_indices: Array.from({ length: control.insights }, (_, i) => i) })) };
        return { stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", name, input }] };
      }),
    },
  },
}));
vi.setConfig({ testTimeout: 180000, hookTimeout: 180000 });

describe.skipIf(!TEST_DATABASE_URL)("export trails read project-level evidence once (EC10K-P01)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  const q = async (sql: string, args: unknown[] = []) => (await db.pool.query(sql, args)).rows;
  const counts = new Map<string, number>();
  let measuring = false;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await q("insert into tenants(id,name) values($1,'Export trail queries')", [tenant]);
    const { pool } = await import("../db");
    pool.on("connect", (client) => {
      const original = client.query.bind(client) as (...a: unknown[]) => unknown;
      (client as unknown as { query: (...a: unknown[]) => unknown }).query = (...args: unknown[]) => {
        if (measuring) {
          const first = args[0] as string | { text?: string };
          const sql = String(typeof first === "string" ? first : first?.text).replace(/\s+/g, " ").trim();
          counts.set(sql, (counts.get(sql) ?? 0) + 1);
        }
        return original(...args);
      };
    });
  });
  afterAll(async () => {
    const { pool, claimPool } = await import("../db");
    await pool.end();
    await claimPool.end();
    await db?.drop();
  });

  /** A project with `size` accepted recommendations, each serving the accepted decision, an objective with a brief passage, and coverage citing every insight. */
  async function project(size: number): Promise<{ run: string; recs: string[] }> {
    const run = (await q("insert into runs(tenant_id,project_name,entry_point,decision_statement,research_objective) values($1,'Trail queries','generate','Whether to expand service capacity','Understand service access') returning id", [tenant]))[0].id as string;
    const objective = (await q("insert into objective_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'Understand service access','r','researcher_authored','accepted') returning id", [tenant, run]))[0].id;
    const decision = (await q("insert into decision_candidates(tenant_id,run_id,candidate_text,rationale,source,status) values($1,$2,'Whether to expand service capacity','r','researcher_authored','accepted') returning id", [tenant, run]))[0].id;
    await q("insert into brief_passages(tenant_id,run_id,field,objective_candidate_id,document_role,quote,verified) values($1,$2,'objective',$3,'brief','We need to understand service access.',true)", [tenant, run, objective]);
    const ids: string[] = [];
    const recs: string[] = [];
    for (let i = 0; i < size; i++) {
      const { insightId } = await insertSupportedInsight(db.pool, tenant, run, `Service pattern ${i}`);
      ids.push(insightId);
      const rec = (await q("insert into recommendations(tenant_id,run_id,synthesized_insight_id,action_text,owner_role,owner_feasibility_note,timeline,metric,priority,assumptions_and_risks,alternatives_considered,status) values($1,$2,$3,$4,'Ops','Feasible','Next quarter','Waiting time','high','Observational','Keep capacity','accepted') returning id", [tenant, run, insightId, `Pilot service change ${i}`]))[0].id;
      await q("insert into recommendation_decisions(recommendation_id,decision_candidate_id,decision_text,position,origin,tenant_id) values($1,$2,'Whether to expand service capacity',0,'model',$3)", [rec, decision, tenant]);
      recs.push(rec);
    }
    control.insights = size;
    await (await import("../objectiveValidator")).generateObjectiveValidation(tenant, run);
    await q(
      "insert into deck_narratives(run_id,tenant_id,executive_summary,situation,complication,question,governing_thought,pillars,recommendations_intro,caveats) values($1,$2,'Pilot','Access','Waiting','Whether to expand service capacity','Pilot first',$3,'Actions follow','[]')",
      [run, tenant, JSON.stringify(ids.map((id) => ({ theme: "Service", headline: "Improve service", so_what: "Pilot", insight_ids: [id], insight_overflow_count: 0 })))],
    );
    return { run, recs };
  }
  async function exportText(route: "docx" | "pptx", run: string): Promise<{ statements: number; perSql: Map<string, number>; text: string }> {
    const mod = route === "docx" ? await import("../../app/api/runs/[id]/story/export-docx/route") : await import("../../app/api/runs/[id]/story/export/route");
    counts.clear();
    measuring = true;
    let response: Response;
    try {
      response = await mod.GET(new Request("http://local/report"), { params: Promise.resolve({ id: run }) });
    } finally {
      measuring = false;
    }
    expect(response.status).toBe(200);
    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
    const names = Object.keys(zip.files).filter((n) => (route === "docx" ? n === "word/document.xml" : /^ppt\/slides\/slide\d+\.xml$/.test(n)));
    const text = (await Promise.all(names.map((n) => zip.files[n].async("string")))).join(" ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    return { statements: [...counts.values()].reduce((a, b) => a + b, 0), perSql: new Map(counts), text };
  }
  const timesRead = (perSql: Map<string, number>, fragment: string) => [...perSql].filter(([sql]) => sql.includes(fragment)).reduce((a, [, n]) => a + n, 0);

  it("statement counts: project-level trail reads happen once per export at any size (Word and Slides)", async () => {
    const results: Record<string, number> = {};
    for (const size of [1, 10, 40]) {
      const { run } = await project(size);
      for (const route of ["docx", "pptx"] as const) {
        const { statements, perSql, text } = await exportText(route, run);
        results[`${route}:${size}`] = statements;
        expect(text).toContain(`Pilot service change ${size - 1}`);
        // Read once for every trail together (the report's own reads of the same tables are separate).
        expect(timesRead(perSql, "from brief_passages p left join documents d")).toBe(1);
        expect(timesRead(perSql, "from recommendation_decisions where recommendation_id = any")).toBe(1);
      }
    }
    console.log(`EC10K-P01 statements after: ${JSON.stringify(results)}`);
    // Each further recommendation now costs its own links only (recommendation, insight, pre-insights,
    // routes and the trail's transaction), not the project-level reads.
    expect((results["docx:40"] - results["docx:10"]) / 30).toBeLessThanOrEqual(7);
  });

  it("every trail read with the shared context equals the same trail read on its own", async () => {
    const { run, recs } = await project(5);
    // One recommendation's decision since reworded: a qualification that must survive the shared read.
    await q("update decision_candidates set candidate_text='Whether to expand capacity this year' where run_id=$1", [run]);
    const { loadTrailContext, loadEvidenceTrail } = await import("../evidenceTrail");
    const { withTenantRead } = await import("../db");
    const shared = await loadTrailContext(tenant, run, recs);
    const alone = await loadTrailContext(tenant, run);
    for (const rec of recs) {
      const a = await withTenantRead(tenant, (c) => loadEvidenceTrail(c, tenant, run, rec, shared));
      const b = await withTenantRead(tenant, (c) => loadEvidenceTrail(c, tenant, run, rec, alone));
      expect(a).toEqual(b);
      expect(a.purpose.some((n) => n.kind === "decision" && n.state === "caution")).toBe(true);
      expect(a.purpose.some((n) => n.kind === "objective" && n.children.some((c) => c.kind === "passage"))).toBe(true);
    }
    // A recommendation of another project is never read through this project's shared context.
    const other = await project(1);
    await expect(withTenantRead(tenant, (c) => loadEvidenceTrail(c, tenant, run, other.recs[0], shared))).rejects.toThrow(/not in this project/);
  });

  it("a failed shared read is stated on every trail of the export, and the next export recovers", async () => {
    const { run } = await project(3);
    control.failPassages = true;
    try {
      const { text } = await exportText("docx", run);
      expect(text.split("The evidence trail could not be read: injected passage read failure").length - 1).toBe(3);
    } finally {
      control.failPassages = false;
    }
    const { text } = await exportText("docx", run);
    expect(text).not.toContain("could not be read");
    expect(text).toContain("We need to understand service access.");
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("real-database checks for batch 64", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
