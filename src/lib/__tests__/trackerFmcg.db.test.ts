// R5 (Grant, 30 October 2026): an FMCG brand tracker end to end on the real engine and a disposable database. Data: a
// small synthetic snack tracker (fixtures/tracker-fmcg, written by make_fmcg.py), two waves as SPSS with labels only.
// Wave 1 asks "Bought in the past 3 months", wave 2 "Bought in the past month" under the same variable names.
// Proves: the file is recognised as FMCG with its windows; the overview shows the FMCG stages in order; every brand's
// weighted share and unweighted base equal an independent pandas reading of the same files (not the app's output); the
// usage change between the waves is withheld because the window changed, while awareness is compared; the tracker type
// is saved as a programme choice through saveTrackerChoices (round trip, stale revision refused, invalid value refused).
// Real PostgreSQL and the actual Python engine; storage is an in-memory stand-in. Skipped, with the reason, without a
// test database or python3 + pandas/pyreadstat.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));

const storage = vi.hoisted(() => ({ objects: new Map<string, Buffer>() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: async (key: string) => (storage.objects.has(key) ? { data: new Blob([new Uint8Array(storage.objects.get(key)!)]), error: null } : { data: null, error: { message: "not found" } }),
        remove: async () => ({ data: [], error: null }),
        upload: async () => ({ data: {}, error: null }),
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat"], { encoding: "utf8" }).status === 0;
const fixture = (n: string) => path.join(process.cwd(), "fixtures", "tracker-fmcg", n);

/** The independent reading: for every 0/1 variable, 100 x sum of weights where it is 1 / sum of weights where it is
 * answered (blank is not asked), and the unweighted count answered. Written with pandas, apart from the app's engine. */
function pandasReading(file: string): Record<string, { share: number; base: number }> {
  const script = [
    "import json, sys, pyreadstat",
    "df, _ = pyreadstat.read_sav(sys.argv[1])",
    "w = df['weight']",
    "out = {}",
    "for c in df.columns:",
    "    if c in ('resp_id', 'weight', 'most_often'): continue",
    "    valid = df[c].notna()",
    "    out[c] = {'share': float(w[df[c] == 1].sum() / w[valid].sum() * 100), 'base': int(valid.sum())}",
    "print(json.dumps(out))",
  ].join("\n");
  const r = spawnSync(PYTHON, ["-I", "-c", script, file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("R5 FMCG tracker: windows, tracker type and figures (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  let run = "";
  const docs: string[] = [];
  const reading = [pandasReading(fixture("fmcg_wave1.sav")), pandasReading(fixture("fmcg_wave2.sav"))];

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    const program = (await q("insert into programs (tenant_id, name) values ($1, 'Snacks') returning id", [tenant]))[0].id;
    run = (await q("insert into runs (tenant_id, project_name, program_id) values ($1, 'Snack tracker', $2) returning id", [tenant, program]))[0].id;
    for (const [w, date] of [[1, "2026-03"], [2, "2026-06"]] as const) {
      const key = `${tenant}/${run}/${randomUUID()}-w${w}.sav`;
      storage.objects.set(key, readFileSync(fixture(`fmcg_wave${w}.sav`)));
      docs.push((await q(
        `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
         values ($1, $2, 'table', 'raw', $3, $4, $5) returning id`,
        [tenant, run, `fmcg_wave${w}.sav`, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true, wave: `Wave ${w}`, waveDate: date })],
      ))[0].id);
    }
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  async function figures(doc: string) {
    const { loadTrackerDashboard } = await import("../trackerDashboards");
    const { loadRoleInput } = await import("../trackerInput");
    const { brandOverviewFigures } = await import("../trackerFigures");
    const view = await loadTrackerDashboard(tenant, run, doc);
    const input = await loadRoleInput(tenant, run, doc);
    return { view, f: await brandOverviewFigures(tenant, run, doc, view.recognition, view.dashboard, input.variables) };
  }

  it("wave 1 is recognised as FMCG from its questions, with each question's window", async () => {
    const { view } = await figures(docs[0]);
    const rec = view.recognition;
    expect(rec.frame?.brands.map((b) => b.label)).toEqual(["Crunchos", "Nutty Bar", "Fresh Bake", "Golden Crisp"]);
    const byGroup = Object.fromEntries(rec.measures.map((m) => [m.group, [m.stage, m.window]]));
    expect(byGroup).toEqual({
      aware: ["awareness", "unknown"],
      consider: ["consideration", "unknown"],
      ever: ["trial", "ever"],
      bought_window: ["usage", "past_3_months"],
      bumo: ["frequent_usage", "unknown"],
    });
    expect(view.dashboard.trackerType).toMatchObject({ type: "fmcg", source: "suggested", suggested: "fmcg" });
    expect(view.dashboard.overviewStages).toEqual(["awareness", "consideration", "trial", "usage", "frequent_usage"]);
  });

  it("every brand's weighted share and base at each FMCG stage equal the independent pandas reading (1e-6)", async () => {
    for (const [i, doc] of docs.entries()) {
      const { f } = await figures(doc);
      expect([f.weighted, f.weightVar]).toEqual([true, "weight"]);
      expect(f.stages.map((s) => [s.stage, s.window])).toEqual([
        ["awareness", "unknown"], ["consideration", "unknown"], ["trial", "ever"], ["usage", i === 0 ? "past_3_months" : "past_month"], ["frequent_usage", "unknown"],
      ]);
      let compared = 0;
      for (const s of f.stages) {
        for (const b of s.byBrand) {
          const ref = reading[i][b.variable];
          expect(b.share, `wave ${i + 1} ${b.variable}`).toBeCloseTo(ref.share, 6);
          expect(b.base, `wave ${i + 1} ${b.variable} base`).toBe(ref.base);
          compared += 1;
        }
      }
      expect(compared).toBe(20);
    }
    // Consideration was asked only of those aware: its base is smaller than everyone (blank is not asked, not "no").
    expect(reading[0].consider_b4.base).toBeLessThan(240);
  });

  it("wave 2 against wave 1: usage is withheld because its window changed; awareness is compared, equal to the pandas difference", async () => {
    const { loadBrandOverview } = await import("../trackerOverview");
    const o = await loadBrandOverview(tenant, run, docs[1]);
    expect(o.previous).toMatchObject({ status: "ok", wave: "Wave 1" });
    for (const code of ["1", "2", "3", "4"]) {
      const usage = o.changes.find((c) => c.stage === "usage" && c.code === code)!;
      expect(usage).toMatchObject({ changePp: null, previous: null, reason: "The time window changed (past 3 months in the previous wave, past month now), so it is not compared." });
      const aware = o.changes.find((c) => c.stage === "awareness" && c.code === code)!;
      expect(aware.changePp).toBeCloseTo(reading[1][`aware_b${code}`].share - reading[0][`aware_b${code}`].share, 6);
    }
    expect(o.stageTiles.map((t) => [t.stage, t.status, t.window])).toEqual([
      ["awareness", "shown", "unknown"], ["consideration", "shown", "unknown"], ["trial", "shown", "ever"], ["usage", "shown", "past_month"], ["frequent_usage", "shown", "unknown"],
    ]);
    // The trend keeps each wave's window, so the screen draws only the waves asked about the same window.
    expect(o.timeline.map((p) => p.stages?.find((s) => s.stage === "usage")?.window)).toEqual(["past_3_months", "past_month"]);
  });

  it("the tracker type is a programme choice: saved with the revision, read back, a stale save and an invalid type refused", async () => {
    const { loadTrackerDashboard, saveTrackerChoices, resetTrackerChoices } = await import("../trackerDashboards");
    const first = await loadTrackerDashboard(tenant, run, docs[0]);
    expect(first.revision).toBeNull();
    const saved = await saveTrackerChoices(tenant, run, docs[0], { scope: first.scopeKey, revision: first.revision }, { trackerType: "durables" }, "researcher");
    expect(saved).toMatchObject({ saved: true });
    // Read back on the other wave of the same programme: chosen Durables, the Durables order, the suggestion still shown.
    const w2 = await loadTrackerDashboard(tenant, run, docs[1]);
    expect(w2.choices.trackerType).toBe("durables");
    expect(w2.dashboard.trackerType).toMatchObject({ type: "durables", source: "chosen", suggested: "fmcg" });
    expect(w2.dashboard.overviewStages).toEqual(["awareness", "consideration", "shortlist", "first_choice", "usage", "acquisition"]);
    const stored = (await q("select choices, suggested from tracker_dashboards where tenant_id = $1", [tenant]))[0];
    expect(stored.choices).toEqual({ trackerType: "durables" });
    expect(stored.suggested.trackerType.type).toBe("fmcg");
    expect(stored.suggested.windows.bought_window).toBe("past_3_months");
    // A save from the first view (stale revision) is refused with the current choices; nothing changes.
    const stale = await saveTrackerChoices(tenant, run, docs[0], { scope: first.scopeKey, revision: first.revision }, { trackerType: "fmcg" }, "other");
    expect(stale).toMatchObject({ saved: false, reason: "conflict", current: { choices: { trackerType: "durables" } } });
    // A value that is not a type is refused before any write.
    const invalid = await saveTrackerChoices(tenant, run, docs[0], { scope: w2.scopeKey, revision: w2.revision }, { trackerType: "services" }, "x");
    expect(invalid).toEqual({ saved: false, reason: "invalid", problems: ['"services" is not a tracker type. Choose Durables or FMCG.'] });
    expect((await q("select choices from tracker_dashboards where tenant_id = $1", [tenant]))[0].choices).toEqual({ trackerType: "durables" });
    // Reset to suggested: the suggestion applies again.
    expect((await resetTrackerChoices(tenant, run, { scope: w2.scopeKey, revision: w2.revision }, "x")).saved).toBe(true);
    const after = await loadTrackerDashboard(tenant, run, docs[0]);
    expect(after.dashboard.trackerType).toMatchObject({ type: "fmcg", source: "suggested" });
  });
});
