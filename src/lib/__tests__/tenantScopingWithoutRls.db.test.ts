// SEC1: tenant isolation that does not depend on row-level security, through the actual loaders,
// route handlers and server actions on a real disposable PostgreSQL.
//
// The app connects through db.ts as the disposable database's owner, a superuser, so row-level
// security is bypassed exactly as it is for the production `postgres` role (docs/database-roles.md).
// Every refusal below therefore comes from the application's own tenant scoping, never from RLS.
// Tenant A is the signed-in organisation; tenant B is another organisation with the same kinds of
// rows. Only the request context (who is signed in), Next's cache and storage are mocked.
//   reads    the home page list, the runs API, the project header, the program lists and three
//            export routes return nothing of B's; B's project answers like a missing one
//   writes   finding status (single and bulk) and theme, program linking (B's program on A's
//            project, A's program on B's project, unlinking B's project), the wave NPS finding,
//            a stated-objective edit, a CSM mapping on B's file and a recommendation rejection
//            change nothing in B and report not found
//   control  the same calls on A's own rows still work; a malformed id is not found, not an error
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

let currentTenant = "";
vi.mock("../requestContext", async () => {
  const real = await vi.importActual<typeof import("../requestContext")>("../requestContext");
  return { ...real, requireTenantId: async () => currentTenant, routeRequestContext: async () => ({ tenantId: currentTenant }) };
});
vi.mock("@/lib/requestContext", async () => {
  const real = await vi.importActual<typeof import("../requestContext")>("../requestContext");
  return { ...real, requireTenantId: async () => currentTenant, routeRequestContext: async () => ({ tenantId: currentTenant }) };
});
// The route handlers import through the app alias, which this repo's Vitest setup does not resolve.
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/analysisPlan", async () => await import("../analysisPlan"));
vi.mock("@/lib/codingAnalysis", async () => await import("../codingAnalysis"));
vi.mock("@/lib/csvField", async () => await import("../csvField"));
vi.mock("@/lib/findingWording", async () => await import("../findingWording"));
vi.mock("@/lib/sourceAttribution", async () => await import("../sourceAttribution"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
// Scoring after an objective edit calls the model; it is an external boundary here.
vi.mock("../objectiveQualityScorer", () => ({ refreshObjectiveQuality: vi.fn(async () => {}) }));
vi.setConfig({ testTimeout: 60000 });

const A = randomUUID();
const B = randomUUID();

describe.skipIf(!TEST_DATABASE_URL)("SEC1 tenant isolation without row-level security (real database, superuser connection)", () => {
  let db: DisposableDb;
  let runA = "", runB = "", programA = "", programB = "", findingA = "", findingB = "", candB = "", docB = "", recB = "";
  const one = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows[0];
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  /** Every column of B's rows that any call below could change, to compare before and after. */
  const snapshotB = async () => ({
    run: await one("select project_name, program_id, wave_label, stated_objectives_text, research_objective from runs where id = $1", [runB]),
    findings: (await db.pool.query("select id, status, theme, finding_text, stated_stats from findings where tenant_id = $1 order by id", [B])).rows,
    candidates: (await db.pool.query("select id, candidate_text, status, edited from objective_candidates where tenant_id = $1 order by id", [B])).rows,
    csm: (await db.pool.query("select document_id, tenant_id, run_id, mapping from csm_modules where document_id = $1", [docB])).rows,
    recommendations: (await db.pool.query("select id, status from recommendations where tenant_id = $1", [B])).rows,
    programs: (await db.pool.query("select id, tenant_id, name from programs order by id")).rows,
  });
  const npsResult = (variable: string) =>
    ({ variable, label: "Recommend", weighted: false, segments: [{ name: "W1", nps: 10, n: 100 }, { name: "W2", nps: 20, n: 100 }] }) as never;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    currentTenant = A;
    await db.pool.query("insert into tenants (id, name) values ($1,'A'),($2,'B')", [A, B]);
    programA = (await one("insert into programs (tenant_id, name) values ($1,'Program A') returning id", [A])).id;
    programB = (await one("insert into programs (tenant_id, name) values ($1,'Program B secret') returning id", [B])).id;
    runA = (await one("insert into runs (tenant_id, project_name) values ($1,'Project A') returning id", [A])).id;
    runB = (await one(
      "insert into runs (tenant_id, project_name, program_id, wave_label, stated_objectives_text) values ($1,'Project B secret',$2,'Wave 1','Grow B') returning id",
      [B, programB],
    )).id;
    findingA = (await one("insert into findings (tenant_id, run_id, origin, finding_text, status, theme) values ($1,$2,'stated','A finding','pending','A theme') returning id", [A, runA])).id;
    findingB = (await one("insert into findings (tenant_id, run_id, origin, finding_text, status, theme) values ($1,$2,'stated','B finding','pending','B theme') returning id", [B, runB])).id;
    await db.pool.query(
      `insert into findings (tenant_id, run_id, origin, finding_text, theme, pattern_type, stated_stats, data_type, status)
       values ($1,$2,'generated','B wave finding','Recommend','trend',$3,'quantitative','accepted')`,
      [B, runB, JSON.stringify({ source: "wave_nps_tool", variable: "Q1", testType: "nps_trend" })],
    );
    candB = (await one(
      "insert into objective_candidates (tenant_id, run_id, candidate_text, rationale, source, status) values ($1,$2,'Grow B','r','researcher_authored','accepted') returning id",
      [B, runB],
    )).id;
    docB = (await one(
      "insert into documents (tenant_id, run_id, kind, source_filename, storage_path, ingestion_type) values ($1,$2,'table','b-secret.sav',$3,'raw') returning id",
      [B, runB, `${B}/${runB}/b.sav`],
    )).id;
    await db.pool.query("insert into csm_modules (tenant_id, run_id, document_id, mapping) values ($1,$2,$3,$4)", [B, runB, docB, JSON.stringify({ owner: "B" })]);
    const insightB = (await one("insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1,$2,$3,'h','o','t','i') returning id", [B, runB, findingB])).id;
    recB = (await one(
      `insert into recommendations (tenant_id, run_id, insight_id, action_text, owner_role, owner_feasibility_note, timeline, metric, priority, assumptions_and_risks, alternatives_considered, source, status)
       values ($1,$2,$3,'Act','o','n','t','m','high','a','b','ai_suggested','accepted') returning id`,
      [B, runB, insightB],
    )).id;
  });

  afterAll(async () => {
    const { pool, claimPool } = await import("../db");
    await pool.end().catch(() => {});
    await claimPool.end().catch(() => {});
    await db?.drop();
  });

  it("connects as a role that bypasses row-level security, so RLS cannot hide a defect here", async () => {
    const { pool } = await import("../db");
    const r = await pool.query("select rolsuper or rolbypassrls as bypass from pg_roles where rolname = current_user");
    expect(r.rows[0].bypass).toBe(true);
  });

  describe("reads", () => {
    it("the home page list and the runs API show only A's projects", async () => {
      const { loadProjectList } = await import("../projectReads");
      const list = await loadProjectList(A);
      expect(list.map((r) => r.id)).toEqual([runA]);
      expect(list[0]).toMatchObject({ findings_total: 1 });
      const { GET } = await import("../../app/api/runs/route");
      const body = await (await GET(new Request("http://test/api/runs"))).json();
      expect(body.runs.map((r: { id: string }) => r.id)).toEqual([runA]);
    });

    it("B's project header reads as missing; A's own reads normally", async () => {
      const { loadRunHeader } = await import("../projectReads");
      expect(await loadRunHeader(A, runB)).toBeNull();
      expect(await loadRunHeader(A, runA)).toMatchObject({ id: runA, project_name: "Project A" });
    });

    it("the program lists hold no B program or B project", async () => {
      const { loadProgramOptions, loadProgramWaves, loadProgramsWithWaves } = await import("../projectReads");
      expect((await loadProgramOptions(A)).map((p) => p.id)).toEqual([programA]);
      expect(await loadProgramWaves(A, programB, runA)).toEqual([]);
      const programs = await loadProgramsWithWaves(A);
      expect(programs.map((p) => p.id)).toEqual([programA]);
      expect(JSON.stringify(programs)).not.toContain("secret");
    });

    it("export routes answer 404 for B's project, naming nothing of it", async () => {
      const routes = [
        await import("../../app/api/runs/[id]/findings/export/route"),
        await import("../../app/api/runs/[id]/coding/extract/route"),
        await import("../../app/api/runs/[id]/history/export/route"),
      ];
      for (const route of routes) {
        const res = await route.GET(new Request(`http://test/api/runs/${runB}/x`), params(runB));
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain("secret");
      }
      // Control: A's own project exports.
      const own = await routes[0].GET(new Request(`http://test/api/runs/${runA}/findings/export`), params(runA));
      expect(own.status).toBe(200);
    });
  });

  describe("writes", () => {
    it("finding status, bulk status and theme on B's finding change nothing and report not found", async () => {
      const f = await import("../findingActions");
      const before = await snapshotB();
      expect(await f.setFindingStatus(runB, findingB, "rejected")).toMatchObject({ ok: false, error: expect.stringContaining("no longer in this project") });
      expect(await f.setManyFindingStatuses(runB, [findingB], "rejected")).toMatchObject({ ok: false });
      expect(await f.setFindingTheme(runB, findingB, "Hijacked")).toMatchObject({ ok: false, error: expect.stringContaining("no longer in this project") });
      expect(await snapshotB()).toEqual(before);
      // Control: A's own finding saves.
      expect(await f.setFindingStatus(runA, findingA, "accepted")).toEqual({ ok: true });
      expect(await f.setFindingTheme(runA, findingA, "Mine")).toEqual({ ok: true });
      expect((await one("select status, theme from findings where id = $1", [findingA]))).toEqual({ status: "accepted", theme: "Mine" });
    });

    it("program linking refuses B's program on A's project, A's program on B's project and unlinking B's project", async () => {
      const { updateProgramLinkAction } = await import("../programActions");
      const before = await snapshotB();
      await expect(updateProgramLinkAction(runA, form({ programId: programB, waveLabel: "W" }))).rejects.toThrow(/not available/);
      expect((await one("select program_id from runs where id = $1", [runA])).program_id).toBeNull();
      await expect(updateProgramLinkAction(runB, form({ programId: programA, waveLabel: "Mine now" }))).rejects.toThrow(/not available/);
      await expect(updateProgramLinkAction(runB, form({ action: "unlink" }))).rejects.toThrow(/not available/);
      await expect(updateProgramLinkAction(runB, form({ newProgramName: "Planted" }))).rejects.toThrow(/not available/);
      expect(await snapshotB()).toEqual(before);
      expect(Number((await one("select count(*) as n from programs where name = 'Planted'")).n)).toBe(0);
      // Control: A links its own project to its own program, then to a new one, then unlinks.
      await updateProgramLinkAction(runA, form({ programId: programA, waveLabel: "W1" }));
      expect(await one("select program_id, wave_label from runs where id = $1", [runA])).toEqual({ program_id: programA, wave_label: "W1" });
      await updateProgramLinkAction(runA, form({ newProgramName: "Program A2" }));
      expect((await one("select p.tenant_id from runs r join programs p on p.id = r.program_id where r.id = $1", [runA])).tenant_id).toBe(A);
      await updateProgramLinkAction(runA, form({ action: "unlink" }));
      expect((await one("select program_id from runs where id = $1", [runA])).program_id).toBeNull();
      // A malformed id is "not available", not a database error.
      await expect(updateProgramLinkAction("not-a-uuid", form({ action: "unlink" }))).rejects.toThrow(/not available/);
      await expect(updateProgramLinkAction(runA, form({ programId: "not-a-uuid" }))).rejects.toThrow(/not available/);
    });

    it("the wave NPS finding cannot be posted into or refreshed on B's project", async () => {
      const { addWaveNpsFindingAction, removeWaveNpsFindingAction } = await import("../waveTrackingActions");
      const before = await snapshotB();
      expect(await addWaveNpsFindingAction(runB, npsResult("Q1"))).toEqual({ ok: false, error: expect.stringContaining("not available") });
      expect(await addWaveNpsFindingAction(runB, npsResult("Q2"))).toEqual({ ok: false, error: expect.stringContaining("not available") });
      expect(await removeWaveNpsFindingAction(runB, "Q1")).toEqual({ ok: false, error: expect.stringContaining("not available") });
      expect(await snapshotB()).toEqual(before);
      // Control: A posts to its own project.
      expect(await addWaveNpsFindingAction(runA, npsResult("Q1"))).toEqual({ ok: true, added: true });
      expect(Number((await one("select count(*) as n from findings where run_id = $1 and tenant_id = $2 and pattern_type = 'trend'", [runA, A])).n)).toBe(1);
    });

    it("a stated-objective edit on B's project and candidate changes nothing and reports not found", async () => {
      const { editStatedObjective } = await import("../runContextActions");
      const before = await snapshotB();
      await expect(editStatedObjective(runB, "Grow B", "Shrink B", { candidateId: candB })).rejects.toThrow(/not found/);
      await expect(editStatedObjective(runB, "Grow B", null, { candidateId: candB })).rejects.toThrow(/not found/);
      expect(await snapshotB()).toEqual(before);
    });

    it("a CSM mapping cannot overwrite B's file's mapping, and a recommendation of B's cannot be rejected", async () => {
      const { saveCsmModuleAction } = await import("../csmActions");
      const { rejectRecommendation } = await import("../recommendationActions");
      const before = await snapshotB();
      expect(await saveCsmModuleAction(runA, docB, { owner: "A" } as never)).toMatchObject({ ok: false, error: expect.stringContaining("not in this project") });
      expect(await saveCsmModuleAction(runB, docB, { owner: "A" } as never)).toMatchObject({ ok: false, error: expect.stringContaining("not available") });
      await rejectRecommendation(runB, recB);
      expect(await snapshotB()).toEqual(before);
    });
  });
});
