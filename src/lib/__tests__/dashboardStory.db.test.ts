// R5story (Grant, 30 October 2026): the brand tracking dashboard as a self-contained story, through the actual server
// actions on a real disposable PostgreSQL with the actual engine; storage is an in-memory stand-in and the model is
// the only thing scripted (the external boundary). Data: the BMW pack's waves 1 and 2 as SPSS with labels only
// (fixtures/tracker-packs/bmw_car), two wave files in one project; BMW chosen as the client's brand.
//   1. Post as finding: one sentence from the card's own figures (equal to the pack's published reference), full
//      provenance; posting again adds nothing (also when two posts race); an unknown card and a card that needs the
//      client brand are refused.
//   2. The normal route still works: verification gives the posted finding a verdict, and insight generation drafts a
//      pre-insight from it.
//   3. Freshness: changing the dashboard choices marks the posted finding for review with the reason, and the
//      pre-insight built on it reads "support changed"; posting the card again (new figures) is a new finding and the
//      earlier one is marked superseded, wording and status kept; a change to the wave's data file marks it too.
//   4. AI insights with a scripted model: a correct insight is an AI draft; an invented number, a causal claim, a
//      significance claim and a number a hostile label asked for are refused with the reason; the figures reach the
//      model only inside the uploaded-content wrapper; a late answer never replaces a newer one; edits are checked
//      (an invented number is not saved), human wording and decisions survive a regeneration; drafts go stale when
//      the page's figures change and a stale one cannot be accepted; an accepted one is posted as a finding once;
//      a decision on an old revision is a conflict.
//   5. Export: the deck builds from the BMW fixture with every page, footnotes carry bases and caveats; drafts are
//      left out unless included (then labelled); the executive summary is refused when nothing is accepted and the
//      deck says so; once insights are accepted the drafted summary (figure-checked) is accepted and exported. The
//      deck is rendered with LibreOffice to page images for a layout check (scratchpad story folder).
// Skipped, with the reason, without a test database or python3 + pandas/pyreadstat.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));

type Req = { tool_choice?: { name?: string }; system?: string; messages: { content: string }[] };
const model = vi.hoisted(() => ({
  /** Per tool: what the model answers (an input object), given the request. */
  answer: {} as Record<string, (req: Req) => Promise<unknown> | unknown>,
  requests: [] as Req[],
}));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "scripted",
  anthropic: {
    messages: {
      create: vi.fn(async (req: Req) => {
        const name = req.tool_choice?.name ?? "";
        model.requests.push(req);
        const script = model.answer[name];
        if (!script) throw new Error(`test: no scripted answer for ${name}`);
        const input = await script(req);
        return { stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", name, input }] };
      }),
    },
  },
}));

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

vi.setConfig({ testTimeout: 600_000, hookTimeout: 300_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat"], { encoding: "utf8" }).status === 0;
const SOFFICE = process.env.LIBREOFFICE_PATH ?? "/usr/bin/soffice";
const STORY_DIR = process.env.R5STORY_RENDER_DIR ?? "";
const packFile = (n: string) => readFileSync(path.join(process.cwd(), "fixtures", "tracker-packs", "bmw_car", n));
type Ref = { wave: number; metric: string; brand: string; expected: number; weighting: string; raw_base: number };
const REF: Ref[] = JSON.parse(packFile("reference_funnel_w1_w2.json").toString("utf8")).results;
const ref = (wave: number, metric: string) => REF.find((r) => r.wave === wave && r.weighting === "weighted" && r.metric === metric && r.brand === "BMW")!;

async function slideTexts(pptx: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(pptx);
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(/(\d+)/.exec(a)![1]) - Number(/(\d+)/.exec(b)![1]));
  return Promise.all(names.map(async (n) => [...(await zip.file(n)!.async("string")).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(" ").replace(/&apos;/g, "'").replace(/&amp;/g, "&")));
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("brand tracking dashboard story: findings, AI insights, slides (real database, actual engine, scripted model)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  let run = "";
  const docs: string[] = [];
  let w2 = "";

  async function project(name: string): Promise<{ run: string; docs: string[] }> {
    const r = (await q("insert into runs (tenant_id, project_name) values ($1, $2) returning id", [tenant, name]))[0].id as string;
    const ds: string[] = [];
    for (const [w, date] of [[1, "2026-02"], [2, "2026-06"]] as const) {
      const key = `${tenant}/${r}/${randomUUID()}-w${w}.sav`;
      storage.objects.set(key, packFile(`wave${w}_labels_only_compressed.sav`));
      ds.push((await q(
        `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
         values ($1, $2, 'table', 'raw', $3, $4, $5) returning id`,
        [tenant, r, `bmw_wave${w}.sav`, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true, wave: `Wave ${w}`, waveDate: date })],
      ))[0].id);
    }
    return { run: r, docs: ds };
  }
  async function choose(r: string, doc: string, choices: Record<string, unknown>) {
    const { loadTrackerDashboardAction, saveTrackerChoicesAction } = await import("../trackerDashboardActions");
    const v = await loadTrackerDashboardAction(r, doc);
    if (!v.ok) throw new Error(v.error);
    const saved = await saveTrackerChoicesAction(r, doc, { scope: v.view.scopeKey, revision: v.view.revision }, choices);
    if (!saved.ok || !saved.saved) throw new Error(`not saved: ${JSON.stringify(saved)}`);
  }
  const dashFindings = (r: string) => q(`select id, status, finding_text, stated_stats as s from findings where run_id = $1 and stated_stats->>'source' = 'tracker_dashboard' order by created_at, id`, [r]);

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    const p = await project("Car tracker");
    run = p.run;
    docs.push(...p.docs);
    w2 = docs[1];
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });
  beforeEach(() => {
    model.answer = {};
    model.requests = [];
  });

  it("1. post as finding: refused without a client brand or for an unknown card; one sentence with full provenance; never duplicated", async () => {
    const { postDashboardCardAction } = await import("../trackerDashboardStoryActions");
    expect(await postDashboardCardAction(run, w2, "overview", "kpis")).toMatchObject({ ok: false, error: expect.stringMatching(/Choose your brand first/) });
    expect(await postDashboardCardAction(run, w2, "overview", "no-such-card")).toMatchObject({ ok: false, error: expect.stringMatching(/not known/) });
    expect(await postDashboardCardAction(run, w2, "../../etc", "kpis")).toMatchObject({ ok: false });
    await choose(run, w2, { focalBrandCode: "8" });

    const first = await postDashboardCardAction(run, w2, "overview", "kpis");
    expect(first).toMatchObject({ ok: true, added: true });
    const rows = await dashFindings(run);
    expect(rows).toHaveLength(1);
    const f = rows[0];
    // The sentence states BMW's figures as the pack publishes them (to one decimal), the wave, weighting and base.
    for (const metric of ["aware", "consider", "shortlist", "firstchoice"]) expect(f.finding_text).toContain(`${ref(2, metric).expected.toFixed(1)}%`);
    expect(f.finding_text).toMatch(/^BMW \(Wave 2, weighted by weight, n=1,000\): awareness /);
    expect(f.finding_text).toContain(`(${(ref(2, "aware").expected - ref(1, "aware").expected) > 0 ? "+" : "-"}${Math.abs(ref(2, "aware").expected - ref(1, "aware").expected).toFixed(1)} pts against Wave 1)`);
    expect(f.finding_text).toMatch(/not tested for significance\.$/);
    expect(f.status).toBe("accepted");
    // Provenance: source, data file, wave, method, weight, base, figures with identities, caveats, the source state.
    expect(f.s).toMatchObject({ source: "tracker_dashboard", kind: "card", page: "overview", card: "kpis", documentId: w2, wave: "Wave 2", weighted: true, weightVar: "weight", focalBrand: { code: "8", label: "BMW" }, readingBase: 1000 });
    expect(f.s.caveats).toEqual(expect.arrayContaining(["descriptive_reading", "weighted_effective_base", "wave_change_untested"]));
    expect(f.s.sourceState.documents.map((d: { id: string }) => d.id).sort()).toEqual([...docs].sort());
    expect(f.s.sourceState.choices).toMatchObject({ scope: `project:${run}`, revision: 1 });
    const aware = f.s.figures.find((x: { key: string }) => x.key === "awareness:8");
    expect(aware.value).toBeCloseTo(ref(2, "aware").expected, 6);
    expect(aware.base).toBe(1000);
    expect(f.s.method).toMatch(/weighted by weight/);
    expect((await q("select human_review_action from findings where id = $1", [f.id]))[0].human_review_action).toBe("tool_add");

    // Posting again adds nothing; two posts at once add one.
    expect(await postDashboardCardAction(run, w2, "overview", "kpis")).toMatchObject({ ok: true, added: false, findingId: f.id });
    const [a, b] = await Promise.all([postDashboardCardAction(run, w2, "overview", "funnel"), postDashboardCardAction(run, w2, "overview", "funnel")]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect((await dashFindings(run)).filter((x) => x.s.card === "funnel")).toHaveLength(1);
    const funnel = (await dashFindings(run)).find((x) => x.s.card === "funnel")!;
    expect(funnel.finding_text).toMatch(/BMW ranks \d+(st|nd|rd|th) of \d+ on awareness \(84\.9%\)/);
    expect(funnel.s.sourceState.documents.map((d: { id: string }) => d.id)).toEqual([w2]);
  });

  it("2. the normal route still works: verification gives a verdict and insight generation drafts from the posted finding", async () => {
    const { refreshVerdicts } = await import("../verifyFindings");
    await refreshVerdicts(tenant, run);
    const verdicts = await q(`select f.stated_stats->>'card' as card, v.verdict_tier, v.statistical_checks from verdicts v join findings f on f.id = v.finding_id where f.run_id = $1`, [run]);
    expect(verdicts.map((v) => v.card).sort()).toEqual(["funnel", "kpis"]);
    expect(verdicts.every((v) => v.verdict_tier === "robust")).toBe(true);
    expect(verdicts[0].statistical_checks.reading_base_size).toEqual({ tag: null, flag: null });
    model.answer.record_insights = (req) => {
      const text = String(req.messages[0].content);
      return { insights: [...text.matchAll(/^(\d+)\. \[[^\n]*?\] (.*)$/gm)].map((m) => ({ index: Number(m[1]), headline: "BMW funnel", observation: m[2], tension: "It sets the bar.", implication: "Track it." })) };
    };
    const { generateInsights } = await import("../insightGenerator");
    const r = await generateInsights(tenant, run);
    expect(r).toMatchObject({ written: 2, notWritten: [] });
    expect(Number((await q("select count(*)::int as n from insights where run_id = $1", [run]))[0].n)).toBe(2);
  });

  it("3. freshness: a choice change marks posted findings for review and their pre-insights stale; a new post supersedes; a data change marks too", async () => {
    const { dashboardFindingStatusAction, postDashboardCardAction } = await import("../trackerDashboardStoryActions");
    const { loadPreInsightSupport } = await import("../supportStatus");
    const before = (await dashFindings(run)).find((x) => x.s.card === "kpis")!;
    const pre = (await q("select id from insights where finding_id = $1", [before.id]))[0].id as string;
    expect((await loadPreInsightSupport(tenant, run, [pre])).statusOf(pre).status).toBe("current");

    await choose(run, w2, { focalBrandCode: "8", weighted: false });
    const marked = (await dashFindings(run)).find((x) => x.id === before.id)!;
    expect(marked.s.caveats).toContain("dashboard_source_changed");
    expect(marked.s.freshness.reasons.join(" ")).toMatch(/dashboard choices were changed/);
    expect(marked.finding_text).toBe(before.finding_text);
    expect(marked.status).toBe("accepted");
    const support = (await loadPreInsightSupport(tenant, run, [pre])).statusOf(pre);
    expect(support.status).toBe("stale");
    expect(support.reasons.map((x) => x.kind)).toContain("figures");
    const statuses = await dashboardFindingStatusAction(run, w2);
    if (!statuses.ok) throw new Error(statuses.error);
    expect(statuses.statuses.find((s) => s.findingId === before.id)).toMatchObject({ stale: true });

    // Unweighted figures differ: a new finding; the earlier one is kept as written and marked superseded.
    const again = await postDashboardCardAction(run, w2, "overview", "kpis");
    expect(again).toMatchObject({ ok: true, added: true, superseded: 1 });
    const after = await dashFindings(run);
    const old = after.find((x) => x.id === before.id)!;
    expect(old.s.caveats).toEqual(expect.arrayContaining(["dashboard_source_changed", "dashboard_superseded"]));
    expect(old.s.supersededByFindingId).toBe((again as { findingId: string }).findingId);
    const fresh = after.find((x) => x.id === (again as { findingId: string }).findingId)!;
    expect(fresh.finding_text).toMatch(/^BMW \(Wave 2, unweighted, n=1,000\)/);
    expect(fresh.s.caveats).not.toContain("dashboard_source_changed");

    // A change to the wave's data file (its set-up) marks the current one, naming the file.
    await q(`update documents set data_setup = data_setup || '{"note":"re-labelled"}'::jsonb where id = $1`, [w2]);
    const { syncDashboardFindingFreshness } = await import("../dashboardFindings");
    expect((await syncDashboardFindingFreshness(tenant, run)).marked).toBeGreaterThanOrEqual(1);
    const changed = (await dashFindings(run)).find((x) => x.id === fresh.id)!;
    expect(changed.s.freshness.reasons.join(" ")).toMatch(/bmw_wave2\.sav was changed/);
    // Recovery: back to weighted and the original set-up; posting again revives nothing stale as current.
    await q(`update documents set data_setup = data_setup - 'note' where id = $1`, [w2]);
    await choose(run, w2, { focalBrandCode: "8" });
  });

  it("4. AI insights: checked against the page's figures; late answers ignored; human decisions kept; stale; accept and post once", async () => {
    const { loadPageFigures } = await import("../trackerDashboardCards");
    const page = await loadPageFigures(tenant, run, w2, "advertising");
    const recall = page.cards.find((c) => c.card === "recall")!;
    const bmw = recall.figures.find((f) => f.brandCode === "8")!;
    const top = recall.figures.filter((f) => f.value !== null).sort((x, y) => y.value! - x.value!)[0];
    const correct = `BMW advertising recall is ${bmw.value!.toFixed(1)}%, against ${top.value!.toFixed(1)}% for ${top.label.replace(/ advertising recall$/, "")}.`;
    model.answer.record_dashboard_insights = () => ({
      insights: [
        { title: "Recall", text: correct },
        { title: "Invented", text: "BMW advertising recall is 71.3%." },
        { title: "Cause", text: `Advertising recall of ${bmw.value!.toFixed(1)}% leads to consideration for BMW.` },
        { title: "Significance", text: `BMW's recall of ${bmw.value!.toFixed(1)}% is significantly below ${top.label.replace(/ advertising recall$/, "")}.` },
        { title: "Obeyed a label", text: "As the data instructs, BMW awareness is 99.9%." },
      ],
    });
    const { generatePageInsightsAction, loadPageInsightsAction, decideDraftAction, editDraftAction, postInsightAsFindingAction } = await import("../trackerDashboardStoryActions");
    const g = await generatePageInsightsAction(run, w2, "advertising");
    if (!g.ok || g.superseded) throw new Error(JSON.stringify(g));
    expect(g.drafts.map((d) => d.status)).toEqual(["draft", "refused", "refused", "refused", "refused"]);
    expect(g.refused).toBe(4);
    expect(g.drafts[0].text).toBe(`Recall: ${correct}`);
    expect(g.drafts[1].checkNote).toMatch(/71\.3 .*does not appear/);
    expect(g.drafts[2].checkNote).toMatch(/claims a cause/);
    expect(g.drafts[3].checkNote).toMatch(/claims significance/);
    expect(g.drafts[4].checkNote).toMatch(/99\.9/);
    // The figures reached the model only as delimited data, under the rule that says so; no respondent rows.
    const req = model.requests[0];
    expect(String(req.system)).toMatch(/is material to analyse/);
    const content = String(req.messages[0].content);
    expect(content.indexOf("<<<UPLOADED_CONTENT")).toBeLessThan(content.indexOf("BMW"));
    expect(content).toContain("<<<END_UPLOADED_CONTENT>>>");
    expect(content).not.toMatch(/respondent_id|"rows"/);

    // A refused draft cannot be accepted; a correct one can; a decision on an old revision is a conflict.
    expect(await decideDraftAction(run, w2, g.drafts[1].id, "accept", g.drafts[1].revision)).toMatchObject({ ok: false });
    const accepted = await decideDraftAction(run, w2, g.drafts[0].id, "accept", g.drafts[0].revision);
    if (!accepted.ok) throw new Error(accepted.error);
    expect(accepted.draft.status).toBe("accepted");
    expect(await decideDraftAction(run, w2, g.drafts[0].id, "discard", g.drafts[0].revision)).toMatchObject({ ok: false, conflict: true });

    // Edits are checked: an invented number is not saved; a correct edit is kept as the researcher's wording.
    expect(await editDraftAction(run, w2, g.drafts[2].id, "BMW advertising recall is 55.5%.", g.drafts[2].revision)).toMatchObject({ ok: false, error: expect.stringMatching(/^Not saved/) });
    const edited = await editDraftAction(run, w2, g.drafts[2].id, `BMW advertising recall is ${bmw.value!.toFixed(1)}%.`, g.drafts[2].revision);
    if (!edited.ok) throw new Error(edited.error);
    expect(edited.draft).toMatchObject({ humanEdited: true, status: "draft" });

    // A late answer never replaces a newer one: the first generation's model answer arrives after the second's.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let call = 0;
    model.answer.record_dashboard_insights = async () => {
      call += 1;
      if (call === 1) {
        await gate;
        return { insights: [{ title: "Old", text: `Older answer: BMW advertising recall is ${bmw.value!.toFixed(1)}%.` }] };
      }
      return { insights: [{ title: "New", text: `Newer answer: BMW advertising recall is ${bmw.value!.toFixed(1)}%.` }] };
    };
    const slow = generatePageInsightsAction(run, w2, "advertising");
    await vi.waitFor(() => expect(call).toBe(1), { timeout: 120_000 });
    const fast = await generatePageInsightsAction(run, w2, "advertising");
    release();
    expect(await slow).toEqual({ ok: true, superseded: true });
    if (!fast.ok || fast.superseded) throw new Error(JSON.stringify(fast));
    const now = await loadPageInsightsAction(run, w2, "advertising");
    if (!now.ok) throw new Error(now.error);
    const texts = now.drafts.map((d) => d.text);
    expect(texts.some((t) => t.startsWith("New: Newer answer"))).toBe(true);
    expect(texts.some((t) => t.includes("Older answer"))).toBe(false);
    // The accepted and the edited drafts survived the regeneration; the untouched and refused ones were replaced.
    expect(now.drafts.find((d) => d.id === g.drafts[0].id)?.status).toBe("accepted");
    expect(now.drafts.find((d) => d.id === g.drafts[2].id)?.humanEdited).toBe(true);
    expect(now.drafts.some((d) => d.id === g.drafts[1].id)).toBe(false);

    // Accepted insight posted as a finding, once.
    const posted = await postInsightAsFindingAction(run, w2, g.drafts[0].id);
    expect(posted).toMatchObject({ ok: true, added: true });
    expect(await postInsightAsFindingAction(run, w2, g.drafts[0].id)).toMatchObject({ ok: true, added: false });
    const finding = (await q("select finding_text, stated_stats as s from findings where id = $1", [(posted as { findingId: string }).findingId]))[0];
    expect(finding.finding_text).toBe(`Recall: ${correct}`);
    expect(finding.s).toMatchObject({ source: "tracker_dashboard", kind: "ai_insight", page: "advertising", aiInsightId: g.drafts[0].id });
    expect(finding.s.caveats).toContain("ai_drafted_wording");

    // The page's figures change (unweighted): drafts are stale and a stale one cannot be accepted.
    await choose(run, w2, { focalBrandCode: "8", weighted: false });
    try {
      const stale = await loadPageInsightsAction(run, w2, "advertising");
      if (!stale.ok) throw new Error(stale.error);
      expect(stale.drafts.every((d) => d.stale)).toBe(true);
      const draft = stale.drafts.find((d) => d.status === "draft")!;
      expect(await decideDraftAction(run, w2, draft.id, "accept", draft.revision)).toMatchObject({ ok: false, error: expect.stringMatching(/figures changed/) });
      expect(await postInsightAsFindingAction(run, w2, g.drafts[0].id)).toMatchObject({ ok: false });
    } finally {
      await choose(run, w2, { focalBrandCode: "8" });
    }
  });

  it("5. export: every page with bases and caveats; drafts only when included; summary refused when nothing is accepted; render", async () => {
    // A second project, nothing accepted yet.
    const p = await project("Car tracker export");
    await choose(p.run, p.docs[1], { focalBrandCode: "8" });
    const { draftModuleStoryAction, generatePageInsightsAction, decideDraftAction, loadModuleStoryAction } = await import("../trackerDashboardStoryActions");
    expect(await draftModuleStoryAction(p.run, p.docs[1], "summary")).toMatchObject({ ok: false, error: expect.stringMatching(/Nothing is accepted yet/) });
    expect(model.requests).toHaveLength(0);
    const { exportTrackerModuleDeck } = await import("../trackerModuleExport");
    const empty = await slideTexts((await exportTrackerModuleDeck(tenant, p.run, p.docs[1], { includeDrafts: false })).pptx);
    expect(empty).toHaveLength(9);
    expect(empty[1]).toContain("Nothing on this dashboard has been accepted yet, so no executive summary is drafted");
    expect(empty[8]).toContain("Nothing on this dashboard has been accepted yet");
    const titles = ["Brand overview", "Moments & needs", "Brand associations", "Advertising & WOM", "Audience & media", "Category overview"];
    titles.forEach((t, i) => {
      const slide = empty[2 + i];
      expect(slide, t).toContain(`PAGE ${String(i + 1).padStart(2, "0")}`);
      expect(slide, t).toContain(t);
      expect(slide, t).toMatch(/Bases? n=/);
      expect(slide, t).toContain("Weighted by weight");
      expect(slide, t).toContain("No insight on this page has been accepted yet.");
    });
    expect(empty[2]).toContain("independent samples, with no significance test");
    expect(empty[2]).toContain(`${ref(2, "aware").expected.toFixed(1)}%`);
    expect(empty[3]).toContain("No significance test is run on this page");

    // Insights: one accepted, one left as a draft.
    const page = await (await import("../trackerDashboardCards")).loadPageFigures(tenant, p.run, p.docs[1], "overview");
    const kpi = page.cards.find((c) => c.card === "kpis")!.figures.find((f) => f.key === "awareness:8")!;
    model.answer.record_dashboard_insights = () => ({
      insights: [
        { title: "Awareness", text: `BMW awareness is ${kpi.value!.toFixed(1)}% in Wave 2.` },
        { title: "Draft only", text: `BMW awareness stands at ${kpi.value!.toFixed(1)}% of all eligible respondents.` },
      ],
    });
    const g = await generatePageInsightsAction(p.run, p.docs[1], "overview");
    if (!g.ok || g.superseded) throw new Error(JSON.stringify(g));
    expect(g.drafts.map((d) => d.status)).toEqual(["draft", "draft"]);
    const acc = await decideDraftAction(p.run, p.docs[1], g.drafts[0].id, "accept", g.drafts[0].revision);
    if (!acc.ok) throw new Error(acc.error);

    // The summary is drafted from the accepted insight only, figure-checked, then accepted.
    model.answer.record_dashboard_story = (req) => {
      const lines = [...String(req.messages[0].content).matchAll(/^\d+\. (.*)$/gm)].map((m) => m[1]);
      expect(lines).toEqual([`Awareness: BMW awareness is ${kpi.value!.toFixed(1)}% in Wave 2.`]);
      return { text: `BMW awareness reached ${kpi.value!.toFixed(1)}% in Wave 2. Keep building on it.` };
    };
    const s = await draftModuleStoryAction(p.run, p.docs[1], "summary");
    if (!s.ok || s.superseded) throw new Error(JSON.stringify(s));
    expect(s.drafts[0]).toMatchObject({ kind: "summary", status: "draft" });
    const story = await loadModuleStoryAction(p.run, p.docs[1]);
    if (!story.ok) throw new Error(story.error);
    const sAcc = await decideDraftAction(p.run, p.docs[1], s.drafts[0].id, "accept", s.drafts[0].revision);
    if (!sAcc.ok) throw new Error(sAcc.error);

    const without = await exportTrackerModuleDeck(tenant, p.run, p.docs[1], { includeDrafts: false });
    const t1 = await slideTexts(without.pptx);
    expect(t1[1]).toContain(`BMW awareness reached ${kpi.value!.toFixed(1)}% in Wave 2.`);
    expect(t1[1]).toContain("Accepted by the researcher");
    expect(t1[2]).toContain(`Awareness: BMW awareness is ${kpi.value!.toFixed(1)}% in Wave 2.`);
    expect(t1.join(" ")).not.toContain("Draft only");
    expect(t1[2]).toContain("1 AI draft is not included");
    expect(t1[8]).toContain("No conclusions and recommendations have been accepted yet");
    const withDrafts = await exportTrackerModuleDeck(tenant, p.run, p.docs[1], { includeDrafts: true });
    const t2 = await slideTexts(withDrafts.pptx);
    expect(t2[2]).toContain("AI DRAFT, NOT ACCEPTED");
    expect(t2[2]).toContain("Draft only");

    // Render: LibreOffice to PDF, then page images, one per slide, saved for the layout check.
    if (existsSync(SOFFICE)) {
      const dir = mkdtempSync(path.join(tmpdir(), "r5story-deck-"));
      try {
        const out = STORY_DIR || dir;
        mkdirSync(out, { recursive: true });
        const file = path.join(out, "brand-tracking-deck.pptx");
        writeFileSync(file, withDrafts.pptx);
        execFileSync(SOFFICE, ["--headless", `-env:UserInstallation=${pathToFileURL(path.join(dir, "profile")).href}`, "--convert-to", "pdf", "--outdir", out, file], { timeout: 300_000 });
        const pdf = path.join(out, "brand-tracking-deck.pdf");
        expect(existsSync(pdf)).toBe(true);
        execFileSync("pdftoppm", ["-png", "-r", "60", pdf, path.join(out, "deck-slide")], { timeout: 120_000 });
        expect(readdirSync(out).filter((n) => /^deck-slide-\d+\.png$/.test(n))).toHaveLength(t2.length);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});
