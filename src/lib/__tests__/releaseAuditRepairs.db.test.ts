// Codex release audit, Part 1 (2026-10-23): RR-F01 (a cut-off brief fill saved as a complete,
// already-used fill), RR-F02 (a cut-off methodology overwriting the saved one) and RR-F03 (project
// deletion losing its storage cleanup). Real database built from every migration, the actual
// actions and extractors; the model client and storage are the external boundaries and are
// controlled here.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../extractFindings", () => ({ readContextDocument: vi.fn() }));
vi.mock("../objectiveQualityScorer", () => ({ refreshObjectiveQuality: vi.fn(async () => {}) }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
// The dashboard notice (rendered below) imports the actions through the app alias and uses the router.
vi.mock("@/lib/runActions", async () => await import("../runActions"));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

type Reply = { stop_reason: string | null; content: { type: string; name?: string; input?: unknown; text?: string }[] };
const model = vi.hoisted(() => ({ replies: [] as Reply[], calls: 0 }));
vi.mock("../anthropic", () => ({
  CLAUDE_MODEL: "controlled",
  anthropic: {
    messages: {
      create: vi.fn(async () => {
        model.calls++;
        const r = model.replies.shift();
        if (!r) throw new Error("test: no scripted reply");
        return { ...r, usage: { input_tokens: 0, output_tokens: 0 } };
      }),
    },
  },
}));

const storage = vi.hoisted(() => ({ removed: [] as string[][], fail: null as string | null, throws: false, objects: new Map<string, string>() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: vi.fn(async (p: string) => (storage.objects.has(p) ? { data: { text: async () => storage.objects.get(p)! }, error: null } : { data: null, error: { message: "not found" } })),
        remove: vi.fn(async (paths: string[]) => {
          storage.removed.push([...paths]);
          if (storage.throws) throw new Error("socket hang up");
          return storage.fail ? { data: null, error: { message: storage.fail } } : { data: paths.map((name) => ({ name })), error: null };
        }),
      }),
    },
  },
}));

const tool = (name: string, input: unknown, stop_reason: string | null = "tool_use"): Reply => ({ stop_reason, content: [{ type: "tool_use", name, input }] });

describe.skipIf(!TEST_DATABASE_URL)("release audit repairs RR-F01, RR-F02, RR-F03 (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  const otherTenant = randomUUID();

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic audit'),($2,'Other organisation')", [tenant, otherTenant]);
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });
  beforeEach(() => {
    model.replies.length = 0;
    model.calls = 0;
    storage.removed.length = 0;
    storage.fail = null;
    storage.throws = false;
  });

  const newRun = async (name = "Audit project", t = tenant) => (await db.pool.query("insert into runs(tenant_id,project_name) values($1,$2) returning id", [t, name])).rows[0].id as string;
  const newDoc = async (run: string, kind: string, text: string | null, extra: { preview?: string; t?: string } = {}) =>
    (
      await db.pool.query(
        "insert into documents(tenant_id,run_id,kind,source_filename,storage_path,preview_storage_path,extracted_text) values($1,$2,$3,'source.docx',$4,$5,$6) returning id, storage_path",
        [extra.t ?? tenant, run, kind, `${extra.t ?? tenant}/${run}/${randomUUID()}-source.docx`, extra.preview ?? null, text],
      )
    ).rows[0] as { id: string; storage_path: string };

  // ------------------------------------------------------------------ RR-F01
  describe("RR-F01: a brief fill is used only from a finished model call", () => {
    const save = async (runId: string, fields: Record<string, string>) => {
      const { saveRunContext } = await import("../runContextActions");
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.set(k, v);
      const result = await saveRunContext(runId, form);
      const row = (await db.pool.query("select business_problem, stated_objectives_text from runs where id=$1", [runId])).rows[0];
      const accepted = (await db.pool.query("select candidate_text from objective_candidates where run_id=$1 and status='accepted' order by created_at", [runId])).rows.map((r) => r.candidate_text);
      const used = Number((await db.pool.query("select count(*) from trace where run_id=$1 and event='brief_intake_used'", [runId])).rows[0].count);
      const failure = (await db.pool.query("select detail from trace where run_id=$1 and event='brief_intake_error' order by id desc limit 1", [runId])).rows[0]?.detail ?? null;
      return { result, row, accepted, used, failure };
    };

    it("a cut-off fill saves nothing from the document, keeps what was typed, records a failure, and the ordinary retry fills", async () => {
      const run = await newRun();
      const brief = await newDoc(run, "evidence", "Brief: measure loyalty and explain churn among members.");
      model.replies.push(tool("record_brief_fields", { business_problem: null, research_objective: "1. Measure loyalty" }, "max_tokens"));
      const first = await save(run, { businessProblem: "Typed problem", researchObjective: "", audience: "", briefDocumentId: brief.id });
      expect(first.result.fill).toMatchObject({ status: "failed" });
      expect(first.failure.message).toMatch(/cut off before it finished/);
      expect(first.row.business_problem).toBe("Typed problem");
      expect(first.row.stated_objectives_text ?? "").not.toContain("Measure loyalty");
      expect(first.accepted).toEqual([]);
      expect(first.used).toBe(0);

      // The same document again, finished: it is read (not "already used") and fills.
      model.replies.push(tool("record_brief_fields", { business_problem: null, research_objective: "1. Measure loyalty\n2. Explain churn" }));
      const second = await save(run, { businessProblem: "Typed problem", researchObjective: "", audience: "", briefDocumentId: brief.id });
      expect(model.calls).toBe(2);
      expect(second.result.fill).toMatchObject({ status: "filled" });
      expect(second.accepted.join("\n")).toMatch(/Measure loyalty[\s\S]*Explain churn/);
      expect(second.used).toBe(1);
    });

    it.each([
      ["a refusal", { stop_reason: "refusal", content: [] }, /declined/],
      ["no tool result", { stop_reason: "tool_use", content: [{ type: "text", text: "Sorry" }] }, /returned no result/],
      ["another tool's result", tool("other_tool", { research_objective: "x" }), /returned no result/],
      ["a malformed field", tool("record_brief_fields", { business_problem: null, research_objective: 42 }), /wrong shape \(research_objective\)/],
      ["a non-object input", tool("record_brief_fields", "objectives"), /wrong shape/],
      // Codex batch10: both fields are required, so a missing one is malformed, not "found nothing".
      ["an empty result", tool("record_brief_fields", {}), /without business_problem/],
      ["a missing business problem", tool("record_brief_fields", { research_objective: "1. Measure loyalty" }), /without business_problem/],
      ["a missing objective", tool("record_brief_fields", { business_problem: null }), /without research_objective/],
    ] as [string, Reply, RegExp][])("%s is a failed fill, not an empty one", async (_label, reply, message) => {
      const run = await newRun();
      const brief = await newDoc(run, "evidence", "Brief text long enough to read for the objectives.");
      model.replies.push(reply);
      const r = await save(run, { businessProblem: "", researchObjective: "", audience: "", briefDocumentId: brief.id });
      expect(r.result.fill).toMatchObject({ status: "failed" });
      expect(r.failure.message).toMatch(message);
      expect(r.used).toBe(0);
    });

    it("a finished call that finds neither field is a fill that found nothing, not a failure", async () => {
      const run = await newRun();
      const brief = await newDoc(run, "evidence", "A brief that states no objectives at all, only a timeline.");
      model.replies.push(tool("record_brief_fields", { business_problem: null, research_objective: null }));
      const r = await save(run, { businessProblem: "", researchObjective: "", audience: "", briefDocumentId: brief.id });
      expect(r.failure).toBeNull();
      expect(r.result.fill?.status).not.toBe("failed");
    });
  });

  // ------------------------------------------------------------------ RR-F02
  describe("RR-F02: the saved methodology is replaced only by a finished reading", () => {
    const methodologyOf = async (run: string) => (await db.pool.query("select methodology from runs where id=$1", [run])).rows[0].methodology as string | null;
    // The processing step's own error record, as page.tsx writes it when the extractor throws.
    const recordFailure = (run: string, message: string) =>
      db.pool.query("insert into trace(tenant_id,run_id,event,detail) values($1,$2,'methodology_extraction_error',$3)", [tenant, run, JSON.stringify({ message })]);

    it("a cut-off reading throws before writing, the previous text stays, and the failure is shown until a finished reading", async () => {
      const { generateMethodologySummary } = await import("../methodologyExtractor");
      const { latestMethodologyFailure } = await import("../methodologyStatus");
      const run = await newRun();
      await db.pool.query("update runs set methodology='Previously complete methodology' where id=$1", [run]);
      await newDoc(run, "report", "Methodology: a survey of 1,000 members by telephone in March, quota sampled by region.");
      model.replies.push(tool("record_methodology", { found: true, methodology_text: "We surveyed respondents using" }, "max_tokens"));
      const err = await generateMethodologySummary(tenant, run).catch((e) => e);
      expect(err?.name).toBe("UnfinishedModelResultError");
      expect(await methodologyOf(run)).toBe("Previously complete methodology");
      await recordFailure(run, err.message);
      expect(await latestMethodologyFailure(tenant, run)).toEqual({ message: err.message, savedEarlier: true });

      model.replies.push(tool("record_methodology", { found: true, methodology_text: "A telephone survey of 1,000 members in March." }));
      expect(await generateMethodologySummary(tenant, run)).toBe("A telephone survey of 1,000 members in March.");
      expect(await methodologyOf(run)).toBe("A telephone survey of 1,000 members in March.");
      expect(await latestMethodologyFailure(tenant, run)).toBeNull();
    });

    it.each([
      ["a refusal", { stop_reason: "refusal", content: [] } as Reply],
      ["no tool result", { stop_reason: "end_turn", content: [{ type: "text", text: "none" }] } as Reply],
      ["found without text", tool("record_methodology", { found: true, methodology_text: "  " })],
      ["a malformed found", tool("record_methodology", { found: "yes", methodology_text: "x" })],
    ])("%s fails without touching the saved text", async (_label, reply) => {
      const { generateMethodologySummary } = await import("../methodologyExtractor");
      const run = await newRun();
      await db.pool.query("update runs set methodology='Kept' where id=$1", [run]);
      await newDoc(run, "evidence", "A brief with a methodology section: twelve in-depth interviews with buyers.");
      model.replies.push(reply);
      await expect(generateMethodologySummary(tenant, run)).rejects.toThrow(/nothing from it was used|declined/);
      expect(await methodologyOf(run)).toBe("Kept");
    });

    it("a finished reading that finds none keeps the saved text and counts as finished", async () => {
      const { generateMethodologySummary } = await import("../methodologyExtractor");
      const { latestMethodologyFailure } = await import("../methodologyStatus");
      const run = await newRun();
      await db.pool.query("update runs set methodology='Kept' where id=$1", [run]);
      await newDoc(run, "evidence", "A brief with no methodology at all, only background and budget lines.");
      await recordFailure(run, "earlier failure");
      model.replies.push(tool("record_methodology", { found: false }));
      expect(await generateMethodologySummary(tenant, run)).toBeNull();
      expect(await methodologyOf(run)).toBe("Kept");
      expect(await latestMethodologyFailure(tenant, run)).toBeNull();
    });

    it("the Word report says the methodology could not be read, rather than that none was stated, when nothing was read before", async () => {
      const { buildNarrativeReportDocx } = await import("../docxReport");
      const base = {
        title: "Audit",
        decisionStatement: null,
        audience: null,
        businessProblem: null,
        researchObjective: null,
        entryPoint: null,
        methodology: null,
        executiveSummary: "Summary.",
        situation: "Situation.",
        complication: "Complication.",
        question: "Question?",
        governingThought: "Thought.",
        documents: [],
        findings: [],
        chartImagesByTheme: [],
        objectiveItems: [],
        unmappedInsightHeadlines: [],
        pillars: [],
        recommendationsIntro: "",
        recommendations: [],
        caveats: [],
        generatedAt: "2026-10-23T10:00:00Z",
      };
      const text = async (input: object) => {
        const zip = await JSZip.loadAsync(await buildNarrativeReportDocx(input as Parameters<typeof buildNarrativeReportDocx>[0]));
        return (await zip.file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, "");
      };
      const unread = await text({ ...base, methodologyUnread: true });
      expect(unread).toContain("could not be read from the uploaded brief, proposal, or report");
      expect(unread).not.toContain("No research methodology was stated");
      expect(await text(base)).toContain("No research methodology was stated");
    });
  });

  // ------------------------------------------------------------------ RR-F03
  describe("RR-F03: deleting a project keeps a record of its files until storage removes them", () => {
    const pending = async () => (await db.pool.query("select run_id, storage_paths, attempts, last_error from project_storage_cleanup where tenant_id=$1 order by id", [tenant])).rows;
    const clearPending = () => db.pool.query("delete from project_storage_cleanup");

    it("removes every source and preview path, and the record, when storage succeeds", async () => {
      await clearPending();
      const { deleteRun } = await import("../runActions");
      const run = await newRun("To delete");
      const a = await newDoc(run, "report", "text", { preview: `${tenant}/${run}/preview.pdf` });
      const b = await newDoc(run, "transcript", null);
      // A single-document cleanup still pending (it would cascade away with the project).
      await db.pool.query("insert into trace(tenant_id,run_id,event,detail) values($1,$2,'document_storage_cleanup_pending',$3)", [tenant, run, JSON.stringify({ documentId: "old", storagePaths: [`${tenant}/${run}/old.docx`] })]);
      expect(await deleteRun(run)).toEqual({ ok: true, cleanupPending: false });
      // Each file's converted copy goes too (Codex batch10 RR-F03), whether or not one was made.
      expect(storage.removed.flat().sort()).toEqual([a.storage_path, `${a.storage_path}.converted.json`, `${tenant}/${run}/preview.pdf`, b.storage_path, `${b.storage_path}.converted.json`, `${tenant}/${run}/old.docx`].sort());
      expect((await db.pool.query("select 1 from runs where id=$1", [run])).rowCount).toBe(0);
      expect(await pending()).toEqual([]);
    });

    it("a storage error, or a thrown storage call, keeps the record with the error; the retry removes the same files and clears it", async () => {
      await clearPending();
      const { deleteRun, retryProjectStorageCleanup } = await import("../runActions");
      const { loadPendingProjectCleanups } = await import("../projectStorageCleanup");
      const run = await newRun("Outage");
      const a = await newDoc(run, "report", "text", { preview: `${tenant}/${run}/p.pdf` });
      storage.fail = "Synthetic storage outage";
      expect(await deleteRun(run)).toEqual({ ok: true, cleanupPending: true });
      expect((await db.pool.query("select 1 from runs where id=$1", [run])).rowCount).toBe(0);
      expect(await pending()).toEqual([{ run_id: run, storage_paths: [a.storage_path, `${tenant}/${run}/p.pdf`, `${a.storage_path}.converted.json`], attempts: 1, last_error: "Synthetic storage outage" }]);
      const shown = await loadPendingProjectCleanups(tenant);
      expect(shown).toMatchObject({ ok: true, items: [{ kind: "deleted_project", projectName: "Outage", locations: 3, attempts: 1, lastError: "Synthetic storage outage" }] });

      storage.fail = null;
      storage.throws = true;
      expect(await retryProjectStorageCleanup()).toEqual({ ok: true, remaining: 1 });
      expect((await pending())[0]).toMatchObject({ attempts: 2, last_error: "socket hang up" });

      storage.throws = false;
      expect(await retryProjectStorageCleanup()).toEqual({ ok: true, remaining: 0 });
      expect(await pending()).toEqual([]);
      expect(storage.removed.at(-1)).toEqual([a.storage_path, `${tenant}/${run}/p.pdf`, `${a.storage_path}.converted.json`]);
    });

    it("refuses an unknown or another organisation's project and deletes nothing", async () => {
      await clearPending();
      const { deleteRun } = await import("../runActions");
      const foreign = await newRun("Theirs", otherTenant);
      await newDoc(foreign, "report", "text", { t: otherTenant });
      expect(await deleteRun(foreign)).toEqual({ ok: false, error: "That project was not found. Nothing was deleted." });
      expect(await deleteRun(randomUUID())).toMatchObject({ ok: false });
      expect((await db.pool.query("select 1 from runs where id=$1", [foreign])).rowCount).toBe(1);
      expect(storage.removed).toEqual([]);
      expect(await pending()).toEqual([]);
    });

    it("leaves a file another document still names, and keeps a path outside the organisation's folder on the record", async () => {
      await clearPending();
      const { deleteRun } = await import("../runActions");
      const run = await newRun("Shared");
      const keeper = await newRun("Keeper");
      const shared = `${tenant}/${keeper}/shared.docx`;
      await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path) values($1,$2,'report','a.docx',$3),($1,$4,'report','b.docx',$3)", [tenant, run, shared, keeper]);
      await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path) values($1,$2,'report','odd.docx','legacy/odd.docx')", [tenant, run]);
      expect(await deleteRun(run)).toEqual({ ok: true, cleanupPending: true });
      // The shared file and its converted copy stay: another project's document still names it.
      expect(storage.removed.flat()).toEqual([]);
      expect(await pending()).toEqual([{ run_id: run, storage_paths: ["legacy/odd.docx", "legacy/odd.docx.converted.json"], attempts: 1, last_error: expect.stringMatching(/outside this organisation's storage folder/) }]);
    });

    // The remote parser's converted copy (Codex RR-F03, batch12 review): recorded before the parser
    // is asked, in a record that does not cascade with the project, removed with its record after
    // the parser answers, and kept in flight when the request fails without an answer.
    describe("the remote parser's converted copy", () => {
      const savFile = async (run: string) =>
        ((await db.pool.query("insert into documents(tenant_id,run_id,kind,source_filename,storage_path,ingestion_type) values($1,$2,'table','survey.sav',$3,'raw') returning storage_path", [tenant, run, `${tenant}/${run}/${randomUUID()}-survey.sav`])).rows[0] as { storage_path: string }).storage_path;
      const table = { headers: ["Q1"], rows: [{ Q1: 1 }], rowCount: 1 };
      const reply = (resultPath: string) => ({ ok: true, status: 200, json: async () => ({ resultPath }), text: async () => "" });
      const copies = async (run: string) => (await db.pool.query("select kind, storage_paths, attempts, last_error, in_flight_until is not null as in_flight from project_storage_cleanup where run_id=$1 order by id", [run])).rows;
      let fetchMock: ReturnType<typeof vi.fn>;
      beforeEach(async () => {
        await clearPending();
        fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        process.env.PARSE_STATS_FILE_URL = "http://parser.test";
        process.env.PARSE_STATS_SHARED_SECRET = "test-secret";
      });
      afterEach(() => {
        vi.unstubAllGlobals();
        delete process.env.PARSE_STATS_FILE_URL;
        storage.objects.clear();
      });

      it("is recorded while the parser runs, then removed with its record; a reply naming another object is refused", async () => {
        const { parseStatsFile } = await import("../parseStatsFile");
        const run = await newRun("Converted");
        const file = await savFile(run);
        const converted = `${file}.converted.json`;
        fetchMock.mockImplementationOnce(async () => {
          // While the parser runs, the copy's record exists and is in flight.
          expect(await copies(run)).toEqual([{ kind: "converted_copy", storage_paths: [converted], attempts: 0, last_error: null, in_flight: true }]);
          storage.objects.set(converted, JSON.stringify(table));
          return reply(converted);
        });
        expect(await parseStatsFile(file, "survey.sav")).toEqual(table);
        expect(storage.removed.at(-1)).toEqual([converted]);
        expect(await copies(run)).toEqual([]);

        fetchMock.mockImplementationOnce(async () => reply(`${tenant}/${run}/someone-else.json`));
        await expect(parseStatsFile(file, "survey.sav")).rejects.toThrow(/unexpected result location/);
        // Only the expected location is removed, never the one the reply named.
        expect(storage.removed.at(-1)).toEqual([converted]);
        expect(storage.removed.flat()).not.toContain(`${tenant}/${run}/someone-else.json`);
        expect(await copies(run)).toEqual([]);
      });

      it("a project deleted while the parser runs, and a removal that then fails, leave the copy on a record the retry removes", async () => {
        const { parseStatsFile } = await import("../parseStatsFile");
        const { deleteRun, retryProjectStorageCleanup } = await import("../runActions");
        const { loadPendingProjectCleanups } = await import("../projectStorageCleanup");
        const run = await newRun("Deleted mid-read");
        const file = await savFile(run);
        const converted = `${file}.converted.json`;
        fetchMock.mockImplementationOnce(async () => {
          // The project is deleted before the parser writes the copy: deletion removes what exists.
          expect(await deleteRun(run)).toEqual({ ok: true, cleanupPending: false });
          storage.objects.set(converted, JSON.stringify(table));
          storage.fail = "Synthetic storage outage";
          return reply(converted);
        });
        expect(await parseStatsFile(file, "survey.sav")).toEqual(table);
        expect((await db.pool.query("select 1 from runs where id=$1", [run])).rowCount).toBe(0);
        // The removal after the read failed: the record outlived the project and holds the error.
        expect(await copies(run)).toEqual([{ kind: "converted_copy", storage_paths: [converted], attempts: 1, last_error: "Synthetic storage outage", in_flight: false }]);
        expect(await loadPendingProjectCleanups(tenant)).toMatchObject({ ok: true, items: [{ kind: "converted_copy", projectName: "Deleted mid-read", locations: 1 }] });

        storage.fail = null;
        expect(await retryProjectStorageCleanup()).toEqual({ ok: true, remaining: 0 });
        expect(storage.removed.at(-1)).toEqual([converted]);
        expect(await copies(run)).toEqual([]);
      });

      it("a request that fails without an answer keeps the record in flight, out of the list and the retry, until its time passes", async () => {
        const { parseStatsFile } = await import("../parseStatsFile");
        const { retryProjectStorageCleanup } = await import("../runActions");
        const { loadPendingProjectCleanups } = await import("../projectStorageCleanup");
        const run = await newRun("No answer");
        const file = await savFile(run);
        const converted = `${file}.converted.json`;
        fetchMock.mockImplementationOnce(async () => {
          throw new Error("fetch failed");
        });
        await expect(parseStatsFile(file, "survey.sav")).rejects.toThrow(/fetch failed/);
        // The parser may still be writing the copy: nothing is removed yet and the record stays.
        expect(storage.removed).toEqual([]);
        expect(await copies(run)).toEqual([{ kind: "converted_copy", storage_paths: [converted], attempts: 0, last_error: null, in_flight: true }]);
        expect(await loadPendingProjectCleanups(tenant)).toMatchObject({ ok: true, items: [] });
        // Not yet due, so not counted as remaining either (the notice does not list it).
        expect(await retryProjectStorageCleanup()).toEqual({ ok: true, remaining: 0 });
        expect(storage.removed).toEqual([]);

        // After the in-flight time the copy is listed and the retry removes it and its record.
        await db.pool.query("update project_storage_cleanup set in_flight_until = now() - interval '1 second' where run_id=$1", [run]);
        expect(await loadPendingProjectCleanups(tenant)).toMatchObject({ ok: true, items: [{ kind: "converted_copy", locations: 1 }] });
        expect(await retryProjectStorageCleanup()).toEqual({ ok: true, remaining: 0 });
        expect(storage.removed.at(-1)).toEqual([converted]);
        expect(await copies(run)).toEqual([]);
      });

      it("a copy whose source another document still names is removed all the same: the copy has no use once read", async () => {
        const { parseStatsFile } = await import("../parseStatsFile");
        const run = await newRun("Named source");
        const file = await savFile(run);
        const converted = `${file}.converted.json`;
        fetchMock.mockImplementationOnce(async () => {
          storage.objects.set(converted, JSON.stringify(table));
          storage.fail = "Synthetic storage outage";
          return reply(converted);
        });
        await parseStatsFile(file, "survey.sav");
        storage.fail = null;
        storage.removed.length = 0;
        const { retryProjectStorageCleanup } = await import("../runActions");
        expect(await retryProjectStorageCleanup()).toEqual({ ok: true, remaining: 0 });
        // Removed by the retry itself, not dropped from the record as "still named".
        expect(storage.removed).toEqual([[converted]]);
        expect(await copies(run)).toEqual([]);
      });

      it("when the copy cannot be recorded the parser is not asked", async () => {
        const { parseStatsFile } = await import("../parseStatsFile");
        await expect(parseStatsFile(`legacy/${randomUUID()}.sav`, "survey.sav")).rejects.toThrow(/not in a project's folder/);
        await expect(parseStatsFile(`${tenant}/${randomUUID()}/x.sav`, "survey.sav")).rejects.toThrow(/Project not found/);
        const run = await newRun("Before 0111");
        const file = await savFile(run);
        await db.pool.query("alter table project_storage_cleanup rename column in_flight_until to in_flight_until_hidden");
        try {
          await expect(parseStatsFile(file, "survey.sav")).rejects.toThrow(/0111_storage_cleanup_in_flight\.sql/);
        } finally {
          await db.pool.query("alter table project_storage_cleanup rename column in_flight_until_hidden to in_flight_until");
        }
        expect(fetchMock).not.toHaveBeenCalled();
      });

      // Codex batch13 RR-M02: the notice counts distinct locations, whatever the records overlap.
      const notice = async () => {
        const { loadPendingProjectCleanups } = await import("../projectStorageCleanup");
        const { default: ProjectCleanupNotice } = await import("../../app/ProjectCleanupNotice");
        const state = await loadPendingProjectCleanups(tenant);
        if (!state.ok) throw new Error(state.error);
        const html = renderToStaticMarkup(createElement(ProjectCleanupNotice, { state }));
        return { state, text: html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ").trim(), items: (html.match(/<li/g) ?? []).length };
      };
      const readFailingRemoval = async (file: string) => {
        const { parseStatsFile } = await import("../parseStatsFile");
        const converted = `${file}.converted.json`;
        fetchMock.mockImplementationOnce(async () => {
          storage.objects.set(converted, JSON.stringify(table));
          storage.fail = "Synthetic storage outage";
          return reply(converted);
        });
        await parseStatsFile(file, "survey.sav");
        storage.fail = null;
      };

      it("two reads of one file whose removals failed are one copy and one location in the notice; the retry clears both records", async () => {
        const { retryProjectStorageCleanup } = await import("../runActions");
        const run = await newRun("Read twice");
        const file = await savFile(run);
        await readFailingRemoval(file);
        await readFailingRemoval(file);
        expect((await copies(run)).length).toBe(2);
        const shown = await notice();
        expect(shown.state).toMatchObject({ locations: 1, items: [{ kind: "converted_copy", locations: 1, records: 2, attempts: 2, lastError: "Synthetic storage outage" }] });
        expect(shown.text).toContain("removal is not yet confirmed for 1 storage location.");
        expect(shown.text).toContain("A converted copy of a data file in Read twice. Last attempt failed: Synthetic storage outage.");
        expect(shown.items).toBe(1);

        storage.removed.length = 0;
        expect(await retryProjectStorageCleanup()).toEqual({ ok: true, remaining: 0 });
        expect(storage.removed).toEqual([[`${file}.converted.json`], [`${file}.converted.json`]]);
        expect(await copies(run)).toEqual([]);
        expect((await notice()).text).toBe("");
      });

      it("a deleted project's record and a copy's record naming the same location count it once", async () => {
        const { deleteRun, retryProjectStorageCleanup } = await import("../runActions");
        const run = await newRun("Overlap");
        const file = await savFile(run);
        await readFailingRemoval(file);
        storage.fail = "Synthetic storage outage";
        expect(await deleteRun(run)).toEqual({ ok: true, cleanupPending: true });
        storage.fail = null;
        const shown = await notice();
        // The project's record names the file and its copy; the copy's record names the copy again.
        expect(shown.state).toMatchObject({ locations: 2, items: [{ kind: "converted_copy", locations: 1 }, { kind: "deleted_project", locations: 2 }] });
        expect(shown.text).toContain("removal is not yet confirmed for 2 storage locations.");
        expect(shown.text).toContain("Deleted project Overlap: 2 storage locations.");
        expect(shown.items).toBe(2);

        expect(await retryProjectStorageCleanup()).toEqual({ ok: true, remaining: 0 });
        expect(await pending()).toEqual([]);
        expect((await notice()).text).toBe("");
      });

      // Codex B15-F01: a grouped copy shows the error of the latest attempt, whatever order its
      // records were created or finished in.
      it("a grouped copy shows the latest attempt's error when its reads finish out of order, and in order; the retry clears both", async () => {
        const { beginConvertedCopy, finishConvertedCopy, loadPendingProjectCleanups } = await import("../projectStorageCleanup");
        const { retryProjectStorageCleanup } = await import("../runActions");
        const shownError = async (run: string) => {
          const state = await loadPendingProjectCleanups(tenant);
          if (!state.ok) throw new Error(state.error);
          const items = state.items.filter((i) => i.projectName === run);
          expect(items).toHaveLength(1);
          return items[0];
        };
        for (const order of ["newer finishes first", "older finishes first"] as const) {
          const name = `Out of order ${order}`;
          const run = await newRun(name);
          const file = await savFile(run);
          const converted = `${file}.converted.json`;
          const older = await beginConvertedCopy(file, converted);
          const newer = await beginConvertedCopy(file, converted);
          const finish = async (intent: typeof older, error: string) => {
            storage.fail = error;
            await finishConvertedCopy(intent, converted, true);
            storage.fail = null;
            // Attempts a few milliseconds apart, so the database times order them (ties are below).
            await new Promise((resolve) => setTimeout(resolve, 20));
          };
          if (order === "newer finishes first") {
            await finish(newer, "Newer request failed first");
            await finish(older, "Older request failed last");
          } else {
            await finish(older, "Older request failed first");
            await finish(newer, "Newer request failed last");
          }
          const item = await shownError(name);
          expect(item).toMatchObject({ kind: "converted_copy", records: 2, attempts: 2, locations: 1 });
          expect(item.lastError).toBe(order === "newer finishes first" ? "Older request failed last" : "Newer request failed last");
          const html = (await notice()).text;
          expect(html).toContain(`Last attempt failed: ${item.lastError}.`);
        }
        // Equal attempt times fall to the later record.
        const tie = await newRun("Same attempt time");
        const tieFile = await savFile(tie);
        const tieCopy = `${tieFile}.converted.json`;
        const first = await beginConvertedCopy(tieFile, tieCopy);
        const second = await beginConvertedCopy(tieFile, tieCopy);
        await db.pool.query("update project_storage_cleanup set in_flight_until = null, attempts = 1, last_attempt_at = '2026-10-24T06:00:00Z', last_error = case when id = $1 then 'First record error' else 'Second record error' end where id = any($2::bigint[])", [first.id, [first.id, second.id]]);
        expect((await shownError("Same attempt time")).lastError).toBe("Second record error");

        expect(await retryProjectStorageCleanup()).toEqual({ ok: true, remaining: 0 });
        expect((await notice()).text).toBe("");
      });

      it("copies of two different files stay two items and two locations", async () => {
        const run = await newRun("Two files");
        await readFailingRemoval(await savFile(run));
        await readFailingRemoval(await savFile(run));
        const shown = await notice();
        expect(shown.state).toMatchObject({ locations: 2, items: [{ records: 1 }, { records: 1 }] });
        expect(shown.text).toContain("removal is not yet confirmed for 2 storage locations.");
        expect(shown.items).toBe(2);
        await clearPending();
      });

      it("deleting the project removes a copy left beside its file", async () => {
        const { deleteRun } = await import("../runActions");
        const run = await newRun("Left copy");
        const file = await savFile(run);
        expect(await deleteRun(run)).toEqual({ ok: true, cleanupPending: false });
        expect(storage.removed.at(-1)).toEqual(expect.arrayContaining([file, `${file}.converted.json`]));
        expect(await pending()).toEqual([]);
      });
    });

    it("without migration 0110 deletion is refused and nothing changes", async () => {
      const { deleteRun } = await import("../runActions");
      const run = await newRun("Before 0110");
      await db.pool.query("alter table project_storage_cleanup rename to project_storage_cleanup_hidden");
      try {
        const r = await deleteRun(run);
        expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/0110_project_storage_cleanup\.sql.*Nothing was deleted/) });
        expect((await db.pool.query("select 1 from runs where id=$1", [run])).rowCount).toBe(1);
      } finally {
        await db.pool.query("alter table project_storage_cleanup_hidden rename to project_storage_cleanup");
      }
    });

    it("without migration 0111 deletion is refused and nothing changes", async () => {
      const { deleteRun } = await import("../runActions");
      const run = await newRun("Before 0111");
      await db.pool.query("alter table project_storage_cleanup rename column in_flight_until to in_flight_until_hidden");
      try {
        expect(await deleteRun(run)).toMatchObject({ ok: false, error: expect.stringMatching(/0111_storage_cleanup_in_flight\.sql.*Nothing was deleted/) });
        expect((await db.pool.query("select 1 from runs where id=$1", [run])).rowCount).toBe(1);
      } finally {
        await db.pool.query("alter table project_storage_cleanup rename column in_flight_until_hidden to in_flight_until");
      }
    });
  });
});
