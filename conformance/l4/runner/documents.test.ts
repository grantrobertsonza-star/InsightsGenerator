// L4 paths B and C: reports and table documents in Word, PDF and PowerPoint.
//   Part 1 (no database): the actual extractDocumentText (LibreOffice + unpdf, storage replaced by an
//     in-memory map) on generated documents whose tables are declared truth: page count, every cell on
//     its page, whether a table row quoted by a report claim can be verified (quoteAppearsIn), chart and
//     picture contents.
//   Part 2 (disposable database): the actual extractAndStoreDocumentTables with the model replaced by a
//     recorded response written from the truth (as a faithful model shown those pages would answer), plus
//     failure answers. Tests what the app stores, never the model's quality.
//   Part 3 (disposable database): an aggregated upload end to end (processTableDocument: engine read,
//     stored table, generated findings) and a report claim checked against it (checkClaimsPending) with
//     a recorded cell-pointing answer.
// Never calls a real model or cloud storage. Results: conformance/l4/out/documents.results.json.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FIXTURES, loadCases, ResultLog } from "./l4lib";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "../../../src/lib/__tests__/helpers/disposableDb";

vi.hoisted(() => {
  process.env.LIBREOFFICE_PATH = process.env.LIBREOFFICE_PATH || "/usr/bin/soffice";
});
vi.mock("../../../src/lib/requestContext", async () => (await import("../../../src/lib/__tests__/helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../../../src/lib/apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));

const model = vi.hoisted(() => ({
  calls: [] as { tool: string; content: string }[],
  answer: (_tool: string, _content: string): unknown => {
    throw new Error("no recorded answer set");
  },
}));
vi.mock("../../../src/lib/anthropic", () => ({
  CLAUDE_MODEL: "recorded",
  anthropic: {
    messages: {
      create: vi.fn(async (req: { system?: string; tool_choice?: { name?: string }; messages: { content: string }[] }) => {
        const tool = req.tool_choice?.name ?? "";
        const content = `${req.system ?? ""}\n${String(req.messages?.[0]?.content ?? "")}`;
        model.calls.push({ tool, content });
        const out = model.answer(tool, content);
        if (out === "NO_TOOL") return { content: [{ type: "text", text: "I could not finish." }], stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 1 } };
        return { content: [{ type: "tool_use", id: "t1", name: tool, input: out }], stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } };
      }),
    },
  },
}));
const storage = vi.hoisted(() => ({ objects: new Map<string, Buffer>() }));
vi.mock("../../../src/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: async (key: string) => (storage.objects.has(key) ? { data: new Blob([new Uint8Array(storage.objects.get(key)!)]), error: null } : { data: null, error: { message: "not found" } }),
        upload: async (key: string, bytes: Buffer) => {
          storage.objects.set(key, Buffer.from(bytes));
          return { data: {}, error: null };
        },
        remove: async () => ({ data: [], error: null }),
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 240_000, hookTimeout: 300_000 });
const log = new ResultLog("documents");
afterAll(() => log.write());

type Spec = { caption: string; headers: string[]; rows: string[][]; group_row?: string[]; page?: number; page_first?: number };
const cases = Object.fromEntries(loadCases().filter((c) => c.path === "BC").map((c) => [c.id, c]));
const add = (caseId: string, check: string, basis: "contract" | "research", expected: unknown, actual: unknown, pass: boolean, severity?: "S1" | "S2" | "S3", note?: string) => {
  log.add({ case: caseId, check, basis, expected, actual, pass, severity, note });
  expect.soft(pass, `${caseId} ${check}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual).slice(0, 400)}`).toBe(true);
};

const pagesCache = new Map<string, { pageNumber: number; text: string }[]>();
async function pagesOf(caseId: string) {
  if (pagesCache.has(caseId)) return pagesCache.get(caseId)!;
  const { extractDocumentText } = await import("../../../src/lib/extractFindings");
  const file = cases[caseId].file;
  const key = `t/r/${path.basename(file)}`;
  storage.objects.set(key, readFileSync(path.join(FIXTURES, file)));
  const out = await extractDocumentText(key, path.basename(file), "doc");
  pagesCache.set(caseId, out.pages);
  return out.pages;
}
const squash = (s: string) => s.replace(/\s+/g, " ");

describe("Part 1: page text of reports (deterministic)", () => {
  it("DOC-01 Word report: table on page 2", async () => {
    const { quoteAppearsIn } = await import("../../../src/lib/quoteMatch");
    const t = cases["DOC-01"].truth as { pages: number; tables: Spec[]; prose: string };
    const pages = await pagesOf("DOC-01");
    log.extra["DOC-01.pages"] = pages.map((p) => squash(p.text).slice(0, 400));
    add("DOC-01", "page_count", "contract", t.pages, pages.length, pages.length === t.pages, "S2", "extractFindings: each Word page gets a real page number");
    const p2 = pages.find((p) => p.pageNumber === 2)?.text ?? "";
    const cells = t.tables[0].rows.flat().concat(t.tables[0].headers);
    const missing = cells.filter((v) => !p2.includes(v));
    add("DOC-01", "cells_on_page", "research", "every cell on page 2", missing.length ? { missing } : "all present", missing.length === 0, "S2");
    add("DOC-01", "prose_quote_verifiable", "contract", true, quoteAppearsIn("Men were more aware than women (64% against 56%).", pages[0]?.text ?? ""), quoteAppearsIn("Men were more aware than women (64% against 56%).", pages[0]?.text ?? ""), "S2");
    const rowQuotes = t.tables[0].rows.map((r) => r.join(" "));
    const verified = rowQuotes.filter((q) => quoteAppearsIn(q, p2));
    add("DOC-01", "table_row_quote_verifiable", "research", rowQuotes, { verified }, verified.length === rowQuotes.length, "S3",
      "A claim read from a table row, quoted as the row reads, should verify against its page (C3).");
  });

  it("DOC-02 Word report: long table across pages", async () => {
    const t = cases["DOC-02"].truth as { tables: Spec[] };
    const pages = await pagesOf("DOC-02");
    const where = t.tables[0].rows.map((r) => pages.filter((p) => p.text.includes(r[0])).map((p) => p.pageNumber));
    const pagesUsed = [...new Set(where.flat())].sort((a, b) => a - b);
    log.extra["DOC-02.rowPages"] = pagesUsed;
    log.extra["DOC-02.pageCount"] = pages.length;
    const allFound = where.every((w) => w.length === 1);
    add("DOC-02", "rows_each_on_one_page", "research", "all 70 rows found, each on one page", { allFound, pagesUsed }, allFound, "S2");
    add("DOC-02", "table_spans_pages", "research", "table starts on page 5 and continues on page 6", pagesUsed, pagesUsed[0] === 5 && pagesUsed.includes(6), "S3",
      "Precondition for the cross-chunk case in part 2 (5 pages per model call).");
  });

  it("DOC-03 PDF: two-level header banner and a simple table", async () => {
    const { quoteAppearsIn } = await import("../../../src/lib/quoteMatch");
    const t = cases["DOC-03"].truth as { pages: number; tables: Spec[] };
    const pages = await pagesOf("DOC-03");
    log.extra["DOC-03.pages"] = pages.map((p) => squash(p.text).slice(0, 400));
    add("DOC-03", "page_count", "contract", t.pages, pages.length, pages.length === t.pages, "S2");
    for (const [i, spec] of t.tables.entries()) {
      const text = pages.find((p) => p.pageNumber === spec.page)?.text ?? "";
      const missing = spec.rows.flat().filter((v) => !text.includes(v));
      add("DOC-03", `table${i + 1}_cells_on_page`, "research", `every cell on page ${spec.page}`, missing.length ? { missing } : "all present", missing.length === 0, "S2");
      const verified = spec.rows.map((r) => r.join(" ")).filter((q) => quoteAppearsIn(q, text));
      add("DOC-03", `table${i + 1}_row_quote_verifiable`, "research", spec.rows.length, verified.length, verified.length === spec.rows.length, "S3");
    }
    // The group row (Wave 1 / Wave 2) is the only thing telling the two Yes columns apart.
    const p1 = pages[0]?.text ?? "";
    add("DOC-03", "group_header_in_text", "research", "Wave 1 and Wave 2 present", { wave1: p1.includes("Wave 1"), wave2: p1.includes("Wave 2") }, p1.includes("Wave 1") && p1.includes("Wave 2"), "S3");
  });

  it("DOC-04 PowerPoint: native table, chart, picture of a table", async () => {
    const t = cases["DOC-04"].truth as { pages: number; tables: Spec[]; chart: { categories: string[]; values: number[]; page: number }; picture_table: Spec };
    const pages = await pagesOf("DOC-04");
    log.extra["DOC-04.pages"] = pages.map((p) => squash(p.text).slice(0, 400));
    add("DOC-04", "page_count", "contract", t.pages, pages.length, pages.length === t.pages, "S2", "Each slide becomes one PDF page (convertToPdf.ts)");
    const p2 = pages.find((p) => p.pageNumber === 2)?.text ?? "";
    const missing = t.tables[0].rows.flat().filter((v) => !p2.includes(v));
    add("DOC-04", "native_table_cells_on_slide", "research", "every cell on page 2", missing.length ? { missing } : "all present", missing.length === 0, "S2");
    const p3 = pages.find((p) => p.pageNumber === 3)?.text ?? "";
    const chartVals = t.chart.values.map(String).filter((v) => new RegExp(`\\b${v}\\b`).test(p3));
    const chartCats = t.chart.categories.filter((v) => p3.includes(v));
    add("DOC-04", "chart_values_readable", "research", { categories: t.chart.categories, values: t.chart.values }, { categories: chartCats, values: chartVals },
      chartVals.length === t.chart.values.length && chartCats.length === t.chart.categories.length, "S2",
      "The chart's data are in the file (embedded chart workbook); only what LibreOffice draws as text reaches the page text.");
    const p4 = pages.find((p) => p.pageNumber === 4)?.text ?? "";
    const picHits = t.picture_table.rows.flat().filter((v) => p4.includes(v));
    add("DOC-04", "picture_table_readable", "research", "table values readable (or the slide flagged as an unread image)", { valuesFound: picHits.length, textLength: p4.trim().length }, picHits.length > 0, "S3",
      "No OCR and no flag: an image of a table is silently invisible.");
  });

  it("DOC-05 PDF that is only a picture of a table", async () => {
    const pages = await pagesOf("DOC-05");
    log.extra["DOC-05.pages"] = pages.map((p) => ({ n: p.pageNumber, chars: p.text.trim().length }));
    add("DOC-05", "image_only_text", "research", "no text (values only in an image)", { pages: pages.length, chars: pages.map((p) => p.text.trim().length) },
      pages.every((p) => p.text.trim().length === 0), "S3", "Precondition for the refusal case in part 2.");
  });
});

// ---------------------------------------------------------------------------------------------
const HAVE_DB = Boolean(TEST_DATABASE_URL);

describe.skipIf(!HAVE_DB)("Parts 2 and 3: stored tables (disposable database, recorded model)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  let run = "";
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    (globalThis as { pgClaimPool?: unknown }).pgClaimPool = undefined;
    // Part 1 already loaded db.ts with no DATABASE_URL; reload the app modules against this database.
    vi.resetModules();
    await db.pool.query("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    run = (await db.pool.query("insert into runs (tenant_id, project_name) values ($1, 'P') returning id", [tenant])).rows[0].id;
  });
  afterAll(async () => {
    const { pool } = await import("../../../src/lib/db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  async function tableDoc(caseId: string, file: string, inRun = run) {
    const key = `${tenant}/${inRun}/${randomUUID()}-${path.basename(file)}`;
    storage.objects.set(key, readFileSync(path.join(FIXTURES, file)));
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path) values ($1, $2, 'table', 'aggregated', $3, $4) returning id`,
      [tenant, inRun, path.basename(file), key],
    ))[0].id as string;
  }
  const pagesIn = (content: string) => [...content.matchAll(/--- Page (\d+) ---/g)].map((m) => Number(m[1]));
  /** A faithful answer: every truth table whose page is in this call, exactly as printed. */
  const faithful = (tables: (Spec & { page: number })[]) => (_tool: string, content: string) => {
    const seen = pagesIn(content);
    // A printed group row spans its columns (merged cells: "Wave 1", "" over Yes, No); the schema asks for each
    // column's group, so a faithful answer carries each group over the columns it spans.
    const groupsOf = (g?: string[]) => {
      if (!g) return undefined;
      let current: string | null = null;
      return g.map((x) => (x ? (current = x) : current));
    };
    return { tables: tables.filter((t) => seen.includes(t.page)).map((t) => ({ page_number: t.page, label: t.caption, headers: t.headers, ...(t.group_row ? { column_groups: groupsOf(t.group_row) } : {}), rows: t.rows })) };
  };
  async function stored(doc: string) {
    return q("select table_index, label, source_page, headers, rows from document_tables where document_id = $1 order by table_index", [doc]);
  }
  async function attempt(doc: string) {
    const { extractAndStoreDocumentTables } = await import("../../../src/lib/documentTables");
    try {
      return { ok: true as const, ids: await extractAndStoreDocumentTables(tenant, run, doc) };
    } catch (e) {
      // An infrastructure fault is not a result of the case.
      if (/ECONNREFUSED|ENOENT|getaddrinfo/.test((e as Error).message)) throw e;
      return { ok: false as const, error: (e as Error).message };
    }
  }

  it("B-01 DOC-01 Word table document, faithful recorded answer", async () => {
    const spec = { ...(cases["DOC-01"].truth as { tables: Spec[] }).tables[0], page: 2 };
    model.calls = [];
    model.answer = faithful([spec]);
    const doc = await tableDoc("DOC-01", cases["DOC-01"].file);
    const r = await attempt(doc);
    const t = await stored(doc);
    add("B-01", "stored", "contract", 1, t.length, r.ok && t.length === 1, "S1");
    if (t.length !== 1) return;
    add("B-01", "label_and_page", "contract", { label: spec.caption, page: 2 }, { label: t[0].label, page: t[0].source_page }, t[0].label === spec.caption && t[0].source_page === 2, "S2");
    const yes = (t[0].rows as Record<string, unknown>[]).find((x) => x.Response === "Yes");
    add("B-01", "cell_identity", "contract", { Total: "60%", Male: "64%", Female: "56%" }, yes ?? null, yes?.Total === "60%" && yes?.Male === "64%" && yes?.Female === "56%", "S2");
    const base = (t[0].rows as Record<string, unknown>[]).find((x) => x.Response === "Base");
    add("B-01", "base_row_kept", "contract", "Base 1000 480 520", base ?? null, base?.Total === "1000", "S3");
  });

  it("B-02 DOC-03 PDF banner with repeated sub-headers (Wave 1 Yes/No, Wave 2 Yes/No)", async () => {
    const t3 = cases["DOC-03"].truth as { tables: Spec[] };
    model.answer = faithful([{ ...t3.tables[0], page: 1 }, { ...t3.tables[1], page: 2 }]);
    const doc = await tableDoc("DOC-03", cases["DOC-03"].file);
    const r = await attempt(doc);
    const t = await stored(doc);
    add("B-02", "stored", "contract", 2, t.length, r.ok && t.length === 2, "S1");
    if (t.length < 1) return;
    const headers = t[0].headers as string[];
    const gauteng = (t[0].rows as Record<string, unknown>[]).find((x) => x.Province === "Gauteng") ?? {};
    const distinct = new Set(headers).size === headers.length;
    add("B-02", "repeated_subheaders_distinct", "research", "4 value columns: Wave 1 Yes 48%, Wave 1 No 52%, Wave 2 Yes 55%, Wave 2 No 45%",
      { headers, gauteng, valuesKept: Object.keys(gauteng).length }, distinct && Object.keys(gauteng).length === 5, "S2",
      "Rows are mapped onto headers by name (setCell); a repeated name keeps only the last value, so Wave 1 is lost while headers still list it twice.");
    add("B-02", "group_row_kept", "research", "Wave 1 / Wave 2 identity on the columns", headers, headers.some((h) => /wave/i.test(h)), "S2",
      "record_tables has one header row; a group row has nowhere to go.");
  });

  it("B-03 DOC-02 table continuing across a 5-page model call boundary", async () => {
    const spec = (cases["DOC-02"].truth as { tables: Spec[] }).tables[0];
    const pages = await pagesOf("DOC-02");
    const rowPage = (r: string[]) => pages.find((p) => p.text.includes(r[0]))?.pageNumber ?? -1;
    // A faithful model sees only its own pages: it reports the part of the table on those pages.
    model.answer = (_tool, content) => {
      const seen = pagesIn(content);
      const part = spec.rows.filter((r) => seen.includes(rowPage(r)));
      if (part.length === 0) return { tables: [] };
      const first = Math.min(...part.map(rowPage));
      return { tables: [{ page_number: first, label: seen.includes(5) ? spec.caption : undefined, headers: spec.headers, rows: part }] };
    };
    model.calls = [];
    const doc = await tableDoc("DOC-02", cases["DOC-02"].file);
    await attempt(doc);
    const t = await stored(doc);
    const rowsStored = t.reduce((n, x) => n + (x.rows as unknown[]).length, 0);
    log.extra["B-03.calls"] = model.calls.map((c) => pagesIn(c.content));
    add("B-03", "one_table_all_rows", "research", { tables: 1, rows: 70, label: spec.caption }, { tables: t.length, rows: rowsStored, labels: t.map((x) => x.label) },
      t.length === 1 && rowsStored === 70, "S2", "Pages go to the model 5 at a time (PAGES_PER_TABLE_DETECTION_CALL); nothing joins a table that continues into the next call.");
  });

  it("B-04 model gives no tool answer (failed retrieval) on a document that has a table", async () => {
    model.answer = () => "NO_TOOL";
    const doc = await tableDoc("DOC-01", cases["DOC-01"].file);
    const r = await attempt(doc);
    const msg = r.ok ? "stored" : r.error;
    add("B-04", "failure_not_reported_as_absence", "contract", "an error saying table detection did not complete (retry), not 'No tables were found'", msg,
      !r.ok && !/No tables were found/.test(msg), "S2", "Standing requirement 1: distinguish absent information from failed retrieval.");
  });

  it("B-05 model names a page the document does not have", async () => {
    const spec = (cases["DOC-01"].truth as { tables: Spec[] }).tables[0];
    model.answer = () => ({ tables: [{ page_number: 99, label: spec.caption, headers: spec.headers, rows: spec.rows }] });
    const doc = await tableDoc("DOC-01", cases["DOC-01"].file);
    await attempt(doc);
    const t = await stored(doc);
    add("B-05", "impossible_page_not_stored", "research", "source_page null or the answer refused (document has 2 pages)", t.map((x) => x.source_page), t.every((x) => x.source_page === null || x.source_page <= 2), "S3");
  });

  it("B-06 model row longer or shorter than the headers", async () => {
    const spec = (cases["DOC-01"].truth as { tables: Spec[] }).tables[0];
    model.answer = () => ({ tables: [{ page_number: 2, label: spec.caption, headers: spec.headers, rows: [["Yes", "60%", "64%", "56%", "extra 9%"], ["No", "35%"], ...spec.rows.slice(2)] }] });
    const doc = await tableDoc("DOC-01", cases["DOC-01"].file);
    const r = await attempt(doc);
    const t = await stored(doc);
    // Flagged: the reading's notes are recorded with the tables (trace document_table_reading_notes, 29 October 2026).
    const notes = (await q("select detail from trace where run_id = $1 and event = 'document_table_reading_notes' and detail->>'documentId' = $2", [run, doc]))
      .flatMap((x) => ((x.detail as { tables: { notes: string[] }[] }).tables ?? []).flatMap((tb) => tb.notes));
    const flagged = notes.some((n) => /more cells than there are columns/.test(n)) && notes.some((n) => /fewer cells than there are columns/.test(n));
    add("B-06", "ragged_rows_flagged", "research", "a row whose length does not match the headers is refused or flagged",
      r.ok ? { stored: t.length, notes } : r.error, !r.ok || flagged, "S3", "Extra cells are dropped and missing cells become blank; both are now recorded with the table.");
  });

  it("B-07 image-only PDF uploaded as a table document", async () => {
    model.calls = [];
    model.answer = () => ({ tables: [] });
    const doc = await tableDoc("DOC-05", cases["DOC-05"].file);
    const r = await attempt(doc);
    add("B-07", "image_only_refused_before_model", "contract", "the 'no page text ... scanned or image-based' refusal, with no model call",
      { error: r.ok ? null : r.error, modelCalls: model.calls.length }, !r.ok && /scanned or image-based/.test(r.error) && model.calls.length === 0, "S3",
      "documentTables.ts refuses only when pages.length is 0; an image-only PDF has a page with empty text.");
  });

  it("B-08 DOC-04 deck: native table stored with its slide; chart data", async () => {
    const t4 = cases["DOC-04"].truth as { tables: Spec[]; chart: { values: number[] } };
    model.answer = faithful([{ ...t4.tables[0], page: 2 }]);
    const doc = await tableDoc("DOC-04", cases["DOC-04"].file);
    await attempt(doc);
    const t = await stored(doc);
    add("B-08", "native_table_slide", "contract", 2, t.map((x) => x.source_page), t.length === 1 && t[0].source_page === 2, "S2");
    add("B-08", "chart_data_as_table", "research", "the chart's data (Male 34, Female 26) available as a table", `${t.length} table(s), none from the chart`, false, "S2",
      "Chart data never reach the table pipeline: the prompt asks for printed tables and the page text holds at most the drawn labels.");
  });

  it("C-01 aggregated upload end to end: stored table, generated findings, and a report claim checked against it", async () => {
    // AGG-08 counts banner (Total row) and AGG-02 frequency table with fractions formatted as %.
    const { processTableDocument } = await import("../../../src/lib/documentTables");
    const counts = await tableDoc("AGG-08", "synthetic/agg08_counts.csv");
    await processTableDocument(tenant, run, counts);
    const f = await q("select finding_text, status, origin from findings where source_table_id in (select id from document_tables where document_id = $1)", [counts]);
    log.extra["C-01.generated"] = f;
    const onTotal = f.filter((x) => /row 5\b/.test(x.finding_text));
    add("C-01", "no_accepted_finding_from_total_row", "research", 0, { stored: f.length, fromTotalRow: onTotal.map((x) => `${x.status}: ${x.finding_text}`) }, onTotal.length === 0, "S2",
      "Row 5 is the Total row; these are stored with status accepted.");

    // The claim check runs in a project of its own (run2) so only this table can be shown to the model,
    // then again in the main project, which by now holds six report tables with "Yes" rows (C-02).
    const run2 = (await q("insert into runs (tenant_id, project_name) values ($1, 'P2') returning id", [tenant]))[0].id as string;
    const claimText = "60% of adults have heard of Brand X (Response Yes, Percent).";
    model.answer = (tool, content) => {
      if (tool !== "record_atoms") return { tables: [] };
      const m = /\[T(\d+)\] data set "agg02_frequency_pctformat\.xlsx"/.exec(content);
      return { atoms: m ? [{ kind: "level", table: Number(m[1]), row: "Yes", col: "Percent", stated_text: "60%" }] : [] };
    };
    const { checkClaimsPending } = await import("../../../src/lib/claimTableChecks");
    const results: Record<string, { stance: string; summary: string; dataset: string | null }[]> = {};
    for (const [label, r] of [["C-01", run2], ["C-02", run]] as const) {
      const freq = await tableDoc("AGG-02", "synthetic/agg02_frequency_pctformat.xlsx", r);
      await processTableDocument(tenant, r, freq);
      const finding = (await q(
        `insert into findings (tenant_id, run_id, origin, finding_text, status, finding_kind, data_type) values ($1, $2, 'stated', $3, 'accepted', 'fact', 'quantitative') returning id`,
        [tenant, r, claimText],
      ))[0].id as string;
      model.calls = [];
      await checkClaimsPending(tenant, r, 10);
      const rows = await q("select dataset_name, stance, summary from claim_table_checks where finding_id = $1", [finding]);
      results[label] = rows.map((x) => ({ stance: x.stance, summary: x.summary, dataset: x.dataset_name }));
      log.extra[`${label}.locatePrompt`] = model.calls.filter((c) => c.tool === "record_atoms").map((c) => c.content.slice(c.content.indexOf("[T1]")).slice(0, 2500));
    }
    const one = results["C-01"].find((x) => x.dataset === "agg02_frequency_pctformat.xlsx");
    add("C-01", "claim_against_percent_formatted_table", "research", "supports (0.6 formatted as 60%)", results["C-01"],
      one?.stance === "supports", one?.stance === "against" ? "S1" : "S2", "End to end through loadViews, candidates, the recorded atom and store.");
    const prompt = String((log.extra["C-01.locatePrompt"] as string[])[0] ?? "");
    add("C-01", "model_shown_exact_values", "research", "the table as stored: 0.6, 0.35, 0.05", prompt.split("\n").filter((l) => /^\s+(Yes|No|Don't know):/.test(l)),
      /No: 350 \| 0\.35/.test(prompt) && /Don't know: 50 \| 0\.05/.test(prompt), "S3",
      "claimTableChecks.render rounds every value to one decimal: 0.35 is shown as 0.4 and 0.05 as 0.1.");
    const two = results["C-02"];
    add("C-02", "right_table_offered_among_others", "research", "the claim's own table (agg02) is among the tables shown to the model",
      two, two.some((x) => x.dataset === "agg02_frequency_pctformat.xlsx"), "S3",
      "candidates(): at most 6 tables by shared words, 2 per data set; report tables mentioning Brand X and Yes outrank the claim's table.");
  });
});
