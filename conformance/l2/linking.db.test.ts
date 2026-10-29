// L2 conformance: how codebook and questionnaire items link to a data file's variables.
// Run: cd /home/claude/b66 && TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres \
//        npx vitest run conformance/l2/linking.db.test.ts --pool=forks
// Writes conformance/l2/results/linking.json (one row per case).
//
// Through the actual readInstrumentItems, suggestInstrumentLinks, confirmInstrumentLinks,
// setInstrumentLinkStatus, chooseInstrumentLink, getInstrumentLinks, getConfirmedItemsForData,
// chooseMatchTarget and removeDocumentToBin, with the local engine (codebook reading and the data
// dictionary) and a real disposable PostgreSQL (createDisposableDb: one uniquely named database, dropped
// afterwards). Mocked boundaries only: storage (in-memory), the AI model (returns hand-read items; used
// only for spreadsheet questionnaires, whose extraction to text is the engine's), usage logging, Next.
//
// Expected values come from the truth each file is generated from and from the contracts
// (claude/codebook-import.md, claude/questionnaire-variable-linking.md, claude/instrument-reread-coverage.md),
// never from the app's output. Case kinds as in run_engine.py: contract (asserted), question and known
// (recorded, never asserted).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "../../src/lib/__tests__/helpers/disposableDb";
import { PYTHON } from "../../src/lib/__tests__/helpers/pythonEngine";

vi.mock("../../src/lib/requestContext", async () => (await import("../../src/lib/__tests__/helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("../../src/lib/__tests__/helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../../src/lib/db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));
vi.mock("../../src/lib/apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));

const model = vi.hoisted(() => ({ items: [] as unknown[], calls: 0 }));
vi.mock("../../src/lib/anthropic", () => ({
  CLAUDE_MODEL: "controlled",
  anthropic: {
    messages: {
      create: vi.fn(async () => {
        model.calls += 1;
        return { stop_reason: "tool_use", usage: { input_tokens: 0, output_tokens: 0 }, content: [{ type: "tool_use", id: "t", name: "record_items", input: { items: model.items } }] };
      }),
    },
  },
}));
const storage = vi.hoisted(() => ({ objects: new Map<string, Buffer>() }));
vi.mock("../../src/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: async (key: string) => (storage.objects.has(key) ? { data: new Blob([new Uint8Array(storage.objects.get(key)!)]), error: null } : { data: null, error: { message: "not found" } }),
        remove: async () => ({ data: [], error: null }),
        upload: async () => ({ data: {}, error: null }),
        copy: async () => ({ data: {}, error: null }),
        move: async () => ({ data: {}, error: null }),
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat, openpyxl"], { encoding: "utf8" }).status === 0;
const IGS = "/mnt/user-data/uploads/InsighsAI/TestProjects/IGS";

// ---------------------------------------------------------------- generators (from declared truth)
type V = { name: string; label: string; opts?: [string, string][]; note?: string };
const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n") + "\n", "utf-8");
const codebookCsv = (vars: V[]) => csv([["Variable", "Label", "Values"], ...vars.map((v) => [v.name, v.label, v.note ?? (v.opts ?? []).map(([c, l]) => `${c}=${l}`).join(", ")])]);
/** A data file with these columns and three rows of codes 1, 2, 1. */
const dataCsv = (names: string[]) => csv([names, ...[1, 2, 1].map((x) => names.map(() => String(x)))]);
const sheetXlsx = (rows: string[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Questionnaire");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};
/** An SPSS file with variable labels, written by pyreadstat (independent of the app). */
function savFile(columns: { name: string; label: string }[]): Buffer {
  const dir = mkdtempSync(path.join(tmpdir(), "l2sav-"));
  const out = path.join(dir, "data.sav");
  const script = `import sys, json, pandas as pd, pyreadstat
cols = json.loads(sys.argv[2])
df = pd.DataFrame({c["name"]: [1, 2, 1] for c in cols})
pyreadstat.write_sav(df, sys.argv[1], column_labels=[c["label"] for c in cols])`;
  const r = spawnSync(PYTHON, ["-c", script, out, JSON.stringify(columns)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return readFileSync(out);
}
const YN: [string, string][] = [["1", "Yes"], ["2", "No"]];

// ---------------------------------------------------------------- recording
type Row = { id: string; title: string; kind: string; status: string; detail?: string; severity?: string; clause?: string };
const results: Row[] = [];
function contract(id: string, title: string, clause: string, severity: string, fn: () => Promise<void>) {
  it(`${id} ${title}`, async () => {
    try {
      await fn();
      results.push({ id, title, kind: "contract", status: "PASS", clause });
    } catch (e) {
      results.push({ id, title, kind: "contract", status: "FAIL", detail: (e as Error).message.slice(0, 800), severity, clause });
      throw e;
    }
  });
}
/** Recorded, never asserted: fn returns whether the result agrees with the hand-read truth. */
function recorded(kind: "question" | "known", id: string, title: string, clause: string, fn: () => Promise<{ agrees: boolean; detail: string }>) {
  it(`${id} [${kind}] ${title}`, async () => {
    const r = await fn();
    const status = kind === "question" ? (r.agrees ? "QUESTION-agrees" : "QUESTION-differs") : r.agrees ? "KNOWN-present" : "KNOWN-absent";
    results.push({ id, title, kind, status, detail: r.detail.slice(0, 800), clause });
  });
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("L2 linking conformance (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const lib = () => import("../../src/lib/instruments");

  beforeAll(async () => {
    db = await createDisposableDb();
    // These cases test the matching rules (which links are suggested, and confirmed by the researcher). CB1's
    // automatic confirmation of codebook entries whose codes fit the data has its own tests
    // (codebookAutoLinks.db.test.ts); it is switched off here by running without migration 0133.
    await db.pool.query("alter table instrument_links drop column if exists decided_by");
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await db.pool.query("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
  });
  afterAll(async () => {
    const { pool } = await import("../../src/lib/db");
    await pool.end().catch(() => {});
    await db?.drop();
    const dir = path.join(__dirname, "results");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "linking.json"), JSON.stringify(results, null, 1));
  });

  const project = async () => (await q("insert into runs (tenant_id, project_name) values ($1, 'P') returning id", [tenant]))[0].id as string;
  async function stored(run: string, kind: "instrument" | "table", name: string, bytes: Buffer, instrumentType: "codebook" | "questionnaire" = "codebook") {
    const key = `${tenant}/${run}/${randomUUID()}-${name}`;
    storage.objects.set(key, bytes);
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, instrument_type, data_setup)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [tenant, run, kind, kind === "table" ? "raw" : null, name, key, kind === "instrument" ? instrumentType : null, kind === "table" ? JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true }) : null],
    ))[0].id as string;
  }
  /** The bytes behind a document change (a reread of a changed file): a new storage key, as the local engine caches by key. */
  async function replaceBytes(doc: string, name: string, bytes: Buffer) {
    const key = `${tenant}/${randomUUID()}-${name}`;
    storage.objects.set(key, bytes);
    await q("update documents set storage_path = $2 where id = $1", [doc, key]);
  }
  type L = { id: string; code: string; variable: string; method: string; confidence: number; status: string; itemId: string };
  const links = async (instrument: string, data?: string): Promise<L[]> =>
    (await q(
      `select l.id, i.code, l.variable, l.method, l.confidence::float as confidence, l.status, i.id as "itemId"
         from instrument_links l join instrument_items i on i.id = l.item_id
        where i.document_id = $1 and ($2::uuid is null or l.data_document_id = $2) order by i.item_order, l.variable`,
      [instrument, data ?? null],
    )) as L[];
  const pairs = (ls: L[]) => ls.map((l) => `${l.code}->${l.variable}:${l.method}:${l.confidence}:${l.status}`);
  const items = async (doc: string) => (await q("select id, code, item_text, response_options from instrument_items where document_id = $1 order by item_order", [doc])) as { id: string; code: string; item_text: string; response_options: { code: string; label: string }[] }[];

  /** One project: a data file with `columns` and a codebook from `vars`, read and matched. */
  async function setup(vars: V[], columns: string[] | Buffer, dataName = "data.csv") {
    const { readInstrumentItems, suggestInstrumentLinks } = await lib();
    const run = await project();
    const data = await stored(run, "table", dataName, Buffer.isBuffer(columns) ? columns : dataCsv(columns));
    const cb = await stored(run, "instrument", "codebook.csv", codebookCsv(vars));
    const read = await readInstrumentItems(tenant, run, cb);
    await suggestInstrumentLinks(tenant, run, cb, data);
    return { run, data, cb, read };
  }
  async function questionnaire(run: string, data: string, modelItems: unknown[], lines: string[][] = [["Questionnaire"], ["(text read by the model)"]]) {
    const { readInstrumentItems, suggestInstrumentLinks } = await lib();
    const doc = await stored(run, "instrument", "questionnaire.xlsx", sheetXlsx(lines), "questionnaire");
    model.items = modelItems;
    await readInstrumentItems(tenant, run, doc);
    const matched = await suggestInstrumentLinks(tenant, run, doc, data);
    return { doc, matched };
  }
  const BASIC: V[] = [
    { name: "id", label: "Respondent identifier", note: "as is" },
    { name: "q1", label: "Would you recommend us to a friend?", opts: YN },
    { name: "q2", label: "Overall satisfaction with the service", opts: [["1", "Satisfied"], ["2", "Dissatisfied"], ["9", "Don't know"]] },
    { name: "region", label: "Region of residence", opts: [["1", "North"], ["2", "South"]] },
  ];
  const QL = "claude/questionnaire-variable-linking.md";
  const CB = "claude/codebook-import.md";

  // ---------------------------------------------------------------- name routes
  contract("L001", "exact names: each codebook entry suggested for its own column at confidence 1", QL + " route 1 exact code", "S1", async () => {
    const { cb, data, read } = await setup(BASIC, ["id", "q1", "q2", "region"]);
    expect(read).toMatchObject({ count: 4, complete: true });
    expect(pairs(await links(cb, data))).toEqual(["id->id:code:1:suggested", "q1->q1:code:1:suggested", "q2->q2:code:1:suggested", "region->region:code:1:suggested"]);
  });
  contract("L002", "'Confirm same-code matches' confirms the four exact links; calculations see them, codebook first", CB + " Linking; questionnaire-meaning-failure.md", "S1", async () => {
    const { confirmInstrumentLinks, getConfirmedItemsForData } = await lib();
    const { run, cb, data } = await setup(BASIC, ["id", "q1", "q2", "region"]);
    expect(await confirmInstrumentLinks(tenant, run, cb, 0.9)).toMatchObject({ confirmed: 4, refused: [] });
    const conf = await getConfirmedItemsForData(tenant, run, data);
    expect(conf.map((c) => [c.variable, c.code, c.confirmed, c.instrumentType])).toEqual([["id", "id", true, "codebook"], ["q1", "q1", true, "codebook"], ["q2", "q2", true, "codebook"], ["region", "region", true, "codebook"]]);
    expect(conf.find((c) => c.variable === "q2")!.options).toEqual([{ code: "1", label: "Satisfied" }, { code: "2", label: "Dissatisfied" }, { code: "9", label: "Don't know" }]);
  });
  contract("L003", "case-insensitive: codebook Q1 links to data q1 at confidence 1", QL + " compares names without case", "S2", async () => {
    const { cb, data } = await setup([{ name: "Q1", label: "One", opts: YN }, { name: "Q2", label: "Two", opts: YN }, { name: "Q3", label: "Three", opts: YN }], ["q1", "q2", "q3"]);
    expect(pairs(await links(cb, data))).toEqual(["Q1->q1:code:1:suggested", "Q2->q2:code:1:suggested", "Q3->q3:code:1:suggested"]);
  });
  contract("L004", "separators are one: codebook q1.a links to data q1_a at confidence 1", QL + " _ . and - as one separator", "S2", async () => {
    const { cb, data } = await setup([{ name: "q1.a", label: "Part a", opts: YN }, { name: "q1.b", label: "Part b", opts: YN }, { name: "q2", label: "Two", opts: YN }], ["q1_a", "q1_b", "q2"]);
    expect(pairs(await links(cb, data))).toEqual(["q1.a->q1_a:code:1:suggested", "q1.b->q1_b:code:1:suggested", "q2->q2:code:1:suggested"]);
  });
  contract("L005", "Q1a links to Q1_a (separator set aside, no digit split)", QL + " where none is equal it ignores separators (Q1a is Q1_a)", "S2", async () => {
    const { cb, data } = await setup([{ name: "Q1a", label: "One a", opts: YN }, { name: "Q2", label: "Two", opts: YN }, { name: "Q3", label: "Three", opts: YN }], ["Q1_a", "Q2", "Q3"]);
    expect(pairs(await links(cb, data))).toContain("Q1a->Q1_a:code:1:suggested");
  });
  contract("L006", "trailing separator: codebook Q1 links to data column q1_", QL + " separators set aside", "S3", async () => {
    const { cb, data } = await setup([{ name: "Q1", label: "One", opts: YN }, { name: "Q2", label: "Two", opts: YN }, { name: "Q3", label: "Three", opts: YN }], ["q1_", "Q2", "Q3"]);
    expect(pairs(await links(cb, data))).toContain("Q1->q1_:code:1:suggested");
  });
  contract("L007", "a single letter-suffixed column (Q1 vs Q1a) is a stem suggestion at 0.8, not bulk-confirmed", QL + " route 3 (0.8 alone)", "S2", async () => {
    const { confirmInstrumentLinks } = await lib();
    const { run, cb, data } = await setup([{ name: "Q1", label: "One", opts: YN }, { name: "Q2", label: "Two", opts: YN }, { name: "Q3", label: "Three", opts: YN }], ["Q1a", "Q2", "Q3"]);
    expect(pairs(await links(cb, data))).toContain("Q1->Q1a:stem:0.8:suggested");
    await confirmInstrumentLinks(tenant, run, cb, 0.9);
    expect(pairs(await links(cb, data))).toContain("Q1->Q1a:stem:0.8:suggested");
  });
  contract("L008", "two letter-suffixed columns (Q1a, Q1b) are stem suggestions at 0.85", QL + " route 3 (0.85)", "S2", async () => {
    const { cb, data } = await setup([{ name: "Q1", label: "One", opts: YN }, { name: "Q2", label: "Two", opts: YN }, { name: "Q3", label: "Three", opts: YN }], ["Q1a", "Q1b", "Q2", "Q3"]);
    const p = pairs(await links(cb, data));
    expect(p).toContain("Q1->Q1a:stem:0.85:suggested");
    expect(p).toContain("Q1->Q1b:stem:0.85:suggested");
  });
  contract("L009", "Q1 never takes Q10 or Q11", QL + " identity is the raw code", "S1", async () => {
    const { cb, data } = await setup([{ name: "Q1", label: "One", opts: YN }, { name: "Q2", label: "Two", opts: YN }, { name: "Q3", label: "Three", opts: YN }], ["Q10", "Q11", "Q2", "Q3"]);
    expect((await links(cb, data)).filter((l) => l.code === "Q1")).toEqual([]);
  });
  contract("L010", "multiple-response family: Q13 suggested for Q13_1..Q13_14 at 0.92 and bulk-confirmed", QL + " route 2 family", "S2", async () => {
    const { confirmInstrumentLinks } = await lib();
    const cols = Array.from({ length: 14 }, (_, k) => `Q13_${k + 1}`);
    const { run, cb, data } = await setup([{ name: "Q13", label: "Sources of news (select all)", opts: [["1", "Selected"]] }, { name: "Q14", label: "Direction", opts: YN }, { name: "Q15", label: "Approval", opts: YN }], [...cols, "Q14", "Q15"]);
    const fam = (await links(cb, data)).filter((l) => l.code === "Q13");
    expect(fam.map((l) => l.variable).sort()).toEqual([...cols].sort());
    expect(new Set(fam.map((l) => `${l.method}:${l.confidence}`))).toEqual(new Set(["stem:0.92"]));
    await confirmInstrumentLinks(tenant, run, cb, 0.9);
    expect((await links(cb, data)).filter((l) => l.code === "Q13" && l.status === "confirmed").length).toBe(14);
  });
  contract("L011", "EN20 family takes EN20_1 and EN20_2 but never EN201", QL + " the separator is the boundary", "S1", async () => {
    const { cb, data } = await setup([{ name: "EN20", label: "Products held", opts: [["1", "Yes"]] }, { name: "Q2", label: "Two", opts: YN }, { name: "Q3", label: "Three", opts: YN }], ["EN20_1", "EN20_2", "EN201", "Q2", "Q3"]);
    expect((await links(cb, data)).filter((l) => l.code === "EN20").map((l) => l.variable).sort()).toEqual(["EN20_1", "EN20_2"]);
  });
  contract("L012", "EN201 never takes EN20_1", QL + " never across a separator between two digits", "S1", async () => {
    const { cb, data } = await setup([{ name: "EN201", label: "Something else", opts: YN }, { name: "Q2", label: "Two", opts: YN }, { name: "Q3", label: "Three", opts: YN }], ["EN20_1", "Q2", "Q3"]);
    expect((await links(cb, data)).filter((l) => l.code === "EN201")).toEqual([]);
  });
  contract("L013", "ambiguous columns q_1 and Q.1 for codebook Q_1 (neither written as the code): both offered at 0.8, neither bulk-confirmed", CB + " IS-F06", "S1", async () => {
    const { confirmInstrumentLinks } = await lib();
    const { run, cb, data } = await setup([{ name: "Q_1", label: "One", opts: YN }, { name: "Q2", label: "Two", opts: YN }, { name: "Q3", label: "Three", opts: YN }], ["q_1", "Q.1", "Q2", "Q3"]);
    const q1 = (await links(cb, data)).filter((l) => l.code === "Q_1");
    expect(q1.map((l) => `${l.variable}:${l.confidence}`).sort()).toEqual(["Q.1:0.8", "q_1:0.8"]);
    await confirmInstrumentLinks(tenant, run, cb, 0.9);
    expect((await links(cb, data)).filter((l) => l.code === "Q_1" && l.status === "confirmed")).toEqual([]);
  });
  recorded("question", "L013b", "columns q1 and Q_1 for codebook Q1: is Q_1 a second candidate (ambiguous) or is q1 the match?", CB + " IS-F06 'case, spacing and separators set aside' vs " + QL + " separators ignored only when none is equal", async () => {
    const { cb, data } = await setup([{ name: "Q1", label: "One", opts: YN }, { name: "Q2", label: "Two", opts: YN }, { name: "Q3", label: "Three", opts: YN }], ["q1", "Q_1", "Q2", "Q3"]);
    const q1 = (await links(cb, data)).filter((l) => l.code === "Q1").map((l) => `${l.variable}:${l.confidence}`).sort();
    return { agrees: JSON.stringify(q1) === JSON.stringify(["Q_1:0.8", "q1:0.8"]), detail: `Q1 offered: ${q1.join(", ")}` };
  });
  contract("L014", "columns q1 and Q1 for codebook q1: the literal one wins at 1, the other is not linked", CB + " IS-F06", "S1", async () => {
    const { cb, data } = await setup([{ name: "q1", label: "One", opts: YN }, { name: "q2", label: "Two", opts: YN }, { name: "q3", label: "Three", opts: YN }], ["q1", "Q1", "q2", "q3"]);
    expect((await links(cb, data)).filter((l) => l.code === "q1").map((l) => `${l.variable}:${l.confidence}`)).toEqual(["q1:1"]);
  });
  recorded("question", "L015", "codebook has entries Q1 and q1, data only Q1: the literal entry Q1 takes it", CB + " IS-F06 covers several columns per item, not several items per column", async () => {
    const { cb, data } = await setup([{ name: "q1", label: "Lower first", opts: YN }, { name: "Q1", label: "Upper", opts: YN }, { name: "Q2", label: "Two", opts: YN }], ["Q1", "Q2"]);
    const p = pairs((await links(cb, data)).filter((l) => l.variable === "Q1"));
    return { agrees: p.length === 1 && p[0].startsWith("Q1->Q1:code:1"), detail: `links to Q1: ${p.join(", ") || "none"}` };
  });
  contract("L016", "names with spaces and CJK link as written; 'Q 1' links to Q1", CB + " IS-F05; " + QL + " spaces removed", "S2", async () => {
    const { cb, data } = await setup([{ name: "Age years", label: "Age", note: "as is" }, { name: "回答", label: "Answer", opts: YN }, { name: "Q 1", label: "One", opts: YN }], ["Age years", "回答", "Q1"]);
    expect(pairs(await links(cb, data))).toEqual(["Age years->Age years:code:1:suggested", "回答->回答:code:1:suggested", "Q 1->Q1:code:1:suggested"]);
  });
  contract("L017", "entries absent from the data (w2) get no link; columns absent from the codebook get none", CB + " 'No variable named w2'", "S2", async () => {
    const { cb, data } = await setup([{ name: "w1", label: "Weight", note: "as is" }, { name: "w2", label: "LA weight", note: "as is" }, { name: "q1", label: "One", opts: YN }], ["w1", "q1", "extra_col"]);
    expect(pairs(await links(cb, data))).toEqual(["w1->w1:code:1:suggested", "q1->q1:code:1:suggested"]);
  });
  contract("L018", "a duplicated codebook entry is one item with one link (first description)", CB + " first description wins", "S2", async () => {
    const { cb, data } = await setup([{ name: "q1", label: "First", opts: YN }, { name: "q2", label: "Two", opts: YN }, { name: "q1", label: "Second", opts: [["1", "A"]] }], ["q1", "q2"]);
    const its = await items(cb);
    expect(its.map((i) => [i.code, i.item_text])).toEqual([["q1", "First"], ["q2", "Two"]]);
    expect(pairs(await links(cb, data))).toEqual(["q1->q1:code:1:suggested", "q2->q2:code:1:suggested"]);
  });

  // ---------------------------------------------------------------- wording routes (SPSS data with labels)
  contract("L020", "wording only: an entry whose code is not in the data is offered by wording, at most 0.89, not bulk-confirmed", QL + " route 5", "S2", async () => {
    const { confirmInstrumentLinks } = await lib();
    const sav = savFile([{ name: "sat", label: "Overall satisfaction with the service you received" }, { name: "rec", label: "Recommend" }]);
    const { run, cb, data } = await setup([{ name: "A7", label: "How satisfied are you overall with the service you received?", opts: YN }, { name: "rec", label: "Recommend", opts: YN }, { name: "zz", label: "Unrelated", opts: YN }], sav, "data.sav");
    const a7 = (await links(cb, data)).filter((l) => l.code === "A7");
    expect(a7.map((l) => [l.variable, l.method, l.status])).toEqual([["sat", "wording", "suggested"]]);
    expect(a7[0].confidence).toBeLessThanOrEqual(0.89);
    await confirmInstrumentLinks(tenant, run, cb, 0.9);
    expect((await links(cb, data)).find((l) => l.code === "A7")!.status).toBe("suggested");
  });
  contract("L021", "a variable label that starts with the code ('Q7. ...') links at 0.9", QL + " route 4", "S2", async () => {
    const sav = savFile([{ name: "sat", label: "Q7. Overall satisfaction" }, { name: "rec", label: "Recommend" }]);
    const { cb, data } = await setup([{ name: "Q7", label: "Satisfaction", opts: YN }, { name: "rec", label: "Recommend", opts: YN }, { name: "zz", label: "Unrelated", opts: YN }], sav, "data.sav");
    expect(pairs((await links(cb, data)).filter((l) => l.code === "Q7"))).toEqual(["Q7->sat:code:0.9:suggested"]);
  });
  contract("L022", "wording with too few shared words is not offered", QL + " route 5 (WORDING_MIN)", "S3", async () => {
    const sav = savFile([{ name: "sat", label: "Overall satisfaction with the service" }, { name: "rec", label: "Recommend" }]);
    const { cb, data } = await setup([{ name: "A9", label: "Which region do you live in?", opts: YN }, { name: "rec", label: "Recommend", opts: YN }, { name: "zz", label: "Unrelated", opts: YN }], sav, "data.sav");
    expect((await links(cb, data)).filter((l) => l.code === "A9")).toEqual([]);
  });

  // ---------------------------------------------------------------- questionnaire through the codebook
  const LONG_TEXT = "How likely are you to recommend our service to a friend or colleague?";
  async function codebookConfirmed(vars: V[], columns: string[]) {
    const { confirmInstrumentLinks } = await lib();
    const s = await setup(vars, columns);
    await confirmInstrumentLinks(tenant, s.run, s.cb, 0.9);
    return s;
  }
  contract("L030", "questionnaire 1A worded identically (5+ words) to confirmed codebook Q1: linked through the codebook, confirmed", CB + " batch 49 rule", "S2", async () => {
    const { getConfirmedItemsForData } = await lib();
    const s = await codebookConfirmed([{ name: "Q1", label: LONG_TEXT, opts: YN }, { name: "Q2", label: "Gender", opts: YN }], ["Q1", "Q2"]);
    const { doc, matched } = await questionnaire(s.run, s.data, [{ code: "1A", text: `1A. ${LONG_TEXT.replace("friend", "friend ")}`, options: [{ code: "1", label: "Yes" }, { code: "2", label: "No" }] }]);
    expect(matched).toMatchObject({ fromCodebook: 1 });
    expect(pairs(await links(doc, s.data))).toEqual(["1A->Q1:codebook:1:confirmed"]);
    expect((await getConfirmedItemsForData(tenant, s.run, s.data)).filter((c) => c.variable === "Q1").map((c) => [c.code, c.instrumentType])).toEqual([["Q1", "codebook"], ["1A", "questionnaire"]]);
  });
  contract("L031", "identical wording of four words is not linked through the codebook", CB + " At least five words", "S2", async () => {
    const s = await codebookConfirmed([{ name: "Q1", label: "How old are you?", opts: YN }, { name: "Q2", label: "Gender", opts: YN }], ["Q1", "Q2"]);
    const { doc } = await questionnaire(s.run, s.data, [{ code: "3", text: "How old are you?", options: [] }]);
    expect((await links(doc, s.data)).filter((l) => l.method === "codebook" || l.status === "confirmed")).toEqual([]);
  });
  contract("L032", "'< 5000' is not '> 5000': not linked through the codebook", CB + " B49-F01 symbols kept", "S1", async () => {
    const s = await codebookConfirmed([{ name: "Q1", label: "Is your monthly household income < 5000 rand?", opts: YN }, { name: "Q2", label: "Gender", opts: YN }], ["Q1", "Q2"]);
    const { doc } = await questionnaire(s.run, s.data, [{ code: "7", text: "Is your monthly household income > 5000 rand?", options: [] }]);
    expect((await links(doc, s.data)).filter((l) => l.method === "codebook" || l.status === "confirmed")).toEqual([]);
  });
  contract("L033", "wording shared by two confirmed codebook entries is ambiguous: not linked through the codebook", CB + " only unambiguous pairs", "S1", async () => {
    const s = await codebookConfirmed([{ name: "Q4_1", label: LONG_TEXT, opts: YN }, { name: "Q4_2", label: LONG_TEXT, opts: YN }, { name: "Q5", label: "Gender", opts: YN }], ["Q4_1", "Q4_2", "Q5"]);
    const { doc } = await questionnaire(s.run, s.data, [{ code: "4", text: LONG_TEXT, options: [] }]);
    expect((await links(doc, s.data)).filter((l) => l.method === "codebook" || l.status === "confirmed")).toEqual([]);
  });
  contract("L034", "two questionnaire items with the same wording: neither linked through the codebook", CB + " exactly one questionnaire item has it", "S1", async () => {
    const s = await codebookConfirmed([{ name: "Q1", label: LONG_TEXT, opts: YN }, { name: "Q2", label: "Gender", opts: YN }], ["Q1", "Q2"]);
    const { doc } = await questionnaire(s.run, s.data, [{ code: "1A", text: LONG_TEXT, options: [] }, { code: "1B", text: LONG_TEXT, options: [] }]);
    expect((await links(doc, s.data)).filter((l) => l.method === "codebook" || l.status === "confirmed")).toEqual([]);
  });
  contract("L035", "a codebook entry only suggested (not confirmed) gives no link through the codebook", CB + " confirmed for a variable", "S1", async () => {
    const s = await setup([{ name: "Q1", label: LONG_TEXT, opts: YN }, { name: "Q2", label: "Gender", opts: YN }], ["Q1", "Q2"]);
    const { doc } = await questionnaire(s.run, s.data, [{ code: "1A", text: LONG_TEXT, options: [] }]);
    expect((await links(doc, s.data)).filter((l) => l.method === "codebook" || l.status === "confirmed")).toEqual([]);
  });
  contract("L036", "codebook and questionnaire may both confirm the same variable; codebook listed first", CB + " LBL-01", "S2", async () => {
    const { confirmInstrumentLinks, getConfirmedItemsForData } = await lib();
    const s = await codebookConfirmed([{ name: "q1", label: "Recommend", opts: YN }, { name: "q2", label: "Gender", opts: YN }], ["q1", "q2"]);
    const { doc } = await questionnaire(s.run, s.data, [{ code: "q1", text: "Would you recommend us?", options: [{ code: "1", label: "Yes" }, { code: "2", label: "No" }] }]);
    expect(await confirmInstrumentLinks(tenant, s.run, doc, 0.9)).toMatchObject({ confirmed: 1, refused: [] });
    expect((await getConfirmedItemsForData(tenant, s.run, s.data)).filter((c) => c.variable === "q1").map((c) => c.instrumentType)).toEqual(["codebook", "questionnaire"]);
  });
  recorded("known", "L037", "questionnaire numbered '13' with data Q13_1..Q13_14 (questionnaire numbers vs data names)", "no route links a bare number to a Q-prefixed family; picker needed", async () => {
    const cols = Array.from({ length: 14 }, (_, k) => `Q13_${k + 1}`);
    const run = await project();
    const data = await stored(run, "table", "data.csv", dataCsv([...cols, "Q14"]));
    const { doc } = await questionnaire(run, data, [{ code: "13", text: "Which of the following sources do you rely on to get news and information about election-related issues?", options: [{ code: "1", label: "Local television news" }] }]);
    const p = pairs(await links(doc, data));
    return { agrees: p.length === 14, detail: `links: ${p.join(", ") || "none"}` };
  });

  // ---------------------------------------------------------------- scope
  contract("L040", "a codebook from another project is refused at matching and nothing is written", CB + " IS-F03", "S1", async () => {
    const { readInstrumentItems, suggestInstrumentLinks } = await lib();
    const active = await project();
    const other = await project();
    const data = await stored(active, "table", "data.csv", dataCsv(["q1", "q2"]));
    const cb = await stored(other, "instrument", "codebook.csv", codebookCsv([{ name: "q1", label: "One", opts: YN }, { name: "q2", label: "Two", opts: YN }]));
    await readInstrumentItems(tenant, other, cb);
    await expect(suggestInstrumentLinks(tenant, active, cb, data)).rejects.toThrow(/not (found )?in this project/);
    expect(await links(cb)).toEqual([]);
  });
  contract("L041", "a codebook in the bin is refused and its confirmed links stop counting", CB + " IS-F03", "S1", async () => {
    const { confirmInstrumentLinks, getConfirmedItemsForData, suggestInstrumentLinks } = await lib();
    const { removeDocumentToBin } = await import("../../src/lib/documentBin");
    const s = await setup(BASIC, ["id", "q1", "q2", "region"]);
    await confirmInstrumentLinks(tenant, s.run, s.cb, 0.9);
    expect((await getConfirmedItemsForData(tenant, s.run, s.data)).length).toBe(4);
    await removeDocumentToBin(tenant, s.run, s.cb, null);
    expect(await getConfirmedItemsForData(tenant, s.run, s.data)).toEqual([]);
    await expect(suggestInstrumentLinks(tenant, s.run, s.cb, s.data)).rejects.toThrow(/not (found )?in this project/);
  });
  contract("L042", "a codebook replaced by a new upload: the old one's links go with it to the bin; the new one starts as suggestions", CB + " IS-F03 / documentBin", "S2", async () => {
    const { readInstrumentItems, suggestInstrumentLinks, confirmInstrumentLinks, getConfirmedItemsForData } = await lib();
    const { removeDocumentToBin } = await import("../../src/lib/documentBin");
    const s = await setup(BASIC, ["id", "q1", "q2", "region"]);
    await confirmInstrumentLinks(tenant, s.run, s.cb, 0.9);
    const fresh = await stored(s.run, "instrument", "codebook_v2.csv", codebookCsv([...BASIC.slice(0, 2), { name: "q2", label: "Satisfaction (revised)", opts: [["1", "Satisfied"], ["2", "Dissatisfied"]] }]));
    await readInstrumentItems(tenant, s.run, fresh);
    await suggestInstrumentLinks(tenant, s.run, fresh, s.data);
    await removeDocumentToBin(tenant, s.run, s.cb, null);
    expect(pairs(await links(fresh, s.data))).toEqual(["id->id:code:1:suggested", "q1->q1:code:1:suggested", "q2->q2:code:1:suggested"]);
    expect(await getConfirmedItemsForData(tenant, s.run, s.data).then((c) => c.filter((x) => x.confirmed))).toEqual([]);
  });

  // ---------------------------------------------------------------- rereads and human decisions
  contract("L050", "reread of the same codebook: item and link identities and confirmations unchanged", "claude/instrument-reread-coverage.md", "S1", async () => {
    const { readInstrumentItems, confirmInstrumentLinks } = await lib();
    const s = await setup(BASIC, ["id", "q1", "q2", "region"]);
    await confirmInstrumentLinks(tenant, s.run, s.cb, 0.9);
    const before = await links(s.cb, s.data);
    expect(await readInstrumentItems(tenant, s.run, s.cb)).toMatchObject({ complete: true, count: 4 });
    expect(await links(s.cb, s.data)).toEqual(before);
  });
  contract("L051", "reread after a confirmed entry's answer codes change: same item, link still confirmed, codes updated", "claude/instrument-reread-coverage.md", "S2", async () => {
    const { readInstrumentItems, confirmInstrumentLinks } = await lib();
    const s = await setup(BASIC, ["id", "q1", "q2", "region"]);
    await confirmInstrumentLinks(tenant, s.run, s.cb, 0.9);
    const before = await links(s.cb, s.data);
    await replaceBytes(s.cb, "codebook.csv", codebookCsv(BASIC.map((v) => (v.name === "q1" ? { ...v, opts: [...YN, ["9", "Don't know"]] as [string, string][] } : v))));
    expect(await readInstrumentItems(tenant, s.run, s.cb)).toMatchObject({ complete: true });
    expect(await links(s.cb, s.data)).toEqual(before);
    expect((await items(s.cb)).find((i) => i.code === "q1")!.response_options).toEqual([{ code: "1", label: "Yes" }, { code: "2", label: "No" }, { code: "9", label: "Don't know" }]);
  });
  contract("L052", "reread after a confirmed entry's label is reworded (same variable name): the confirmed link survives", "standing requirements 3 and 9; claude/instrument-reread-coverage.md stable confirmed IDs", "S2", async () => {
    const { readInstrumentItems, confirmInstrumentLinks } = await lib();
    const s = await setup(BASIC, ["id", "q1", "q2", "region"]);
    await confirmInstrumentLinks(tenant, s.run, s.cb, 0.9);
    await replaceBytes(s.cb, "codebook.csv", codebookCsv(BASIC.map((v) => (v.name === "q1" ? { ...v, label: "Would you recommend us to a friend or colleague?" } : v))));
    expect(await readInstrumentItems(tenant, s.run, s.cb)).toMatchObject({ complete: true, count: 4 });
    expect(pairs(await links(s.cb, s.data))).toContain("q1->q1:code:1:confirmed");
  });
  contract("L053", "reread after a variable is dropped from the codebook: its item and links go, others stay confirmed", CB + " / instruments.ts an item that genuinely dropped out is removed", "S2", async () => {
    const { readInstrumentItems, confirmInstrumentLinks } = await lib();
    const s = await setup(BASIC, ["id", "q1", "q2", "region"]);
    await confirmInstrumentLinks(tenant, s.run, s.cb, 0.9);
    await replaceBytes(s.cb, "codebook.csv", codebookCsv(BASIC.filter((v) => v.name !== "region")));
    expect(await readInstrumentItems(tenant, s.run, s.cb)).toMatchObject({ complete: true, count: 3 });
    expect(pairs(await links(s.cb, s.data))).toEqual(["id->id:code:1:confirmed", "q1->q1:code:1:confirmed", "q2->q2:code:1:confirmed"]);
  });
  contract("L054", "reread where a confirmed entry's answer list is now unreadable: read incomplete, previous codes and link kept", CB + " IS-F04 'does not replace an earlier complete reading'", "S1", async () => {
    const { readInstrumentItems, confirmInstrumentLinks } = await lib();
    const s = await setup(BASIC, ["id", "q1", "q2", "region"]);
    await confirmInstrumentLinks(tenant, s.run, s.cb, 0.9);
    await replaceBytes(s.cb, "codebook.csv", codebookCsv(BASIC.map((v) => (v.name === "q2" ? { ...v, opts: undefined, note: "1=Satisfied 2=Dissatisfied" } : v))));
    expect(await readInstrumentItems(tenant, s.run, s.cb)).toMatchObject({ complete: false, incompleteItems: 1 });
    expect((await items(s.cb)).find((i) => i.code === "q2")!.response_options).toEqual([{ code: "1", label: "Satisfied" }, { code: "2", label: "Dissatisfied" }, { code: "9", label: "Don't know" }]);
    expect(pairs(await links(s.cb, s.data))).toContain("q2->q2:code:1:confirmed");
  });
  contract("L055", "matching again keeps confirmed and rejected links and adds no duplicates", QL + " Matching again", "S1", async () => {
    const { confirmInstrumentLinks, setInstrumentLinkStatus, suggestInstrumentLinks } = await lib();
    const s = await setup(BASIC, ["id", "q1", "q2", "region"]);
    await confirmInstrumentLinks(tenant, s.run, s.cb, 0.9);
    const region = (await links(s.cb, s.data)).find((l) => l.code === "region")!;
    await setInstrumentLinkStatus(tenant, s.run, region.id, "rejected");
    const before = await links(s.cb, s.data);
    await suggestInstrumentLinks(tenant, s.run, s.cb, s.data);
    await suggestInstrumentLinks(tenant, s.run, s.cb, s.data);
    expect(await links(s.cb, s.data)).toEqual(before);
    expect(pairs(before)).toContain("region->region:code:1:rejected");
  });
  contract("L056", "a variable confirmed for one entry is refused for another entry of the same codebook, naming it", CB + " IR-04 variableTakenBy", "S1", async () => {
    const { confirmInstrumentLinks, chooseInstrumentLink } = await lib();
    const s = await setup(BASIC, ["id", "q1", "q2", "region"]);
    await confirmInstrumentLinks(tenant, s.run, s.cb, 0.9);
    const q2Item = (await items(s.cb)).find((i) => i.code === "q2")!.id;
    await expect(chooseInstrumentLink(tenant, s.run, s.cb, q2Item, s.data, "q1")).rejects.toThrow(/q1 is already confirmed for q1/);
    expect((await links(s.cb, s.data)).filter((l) => l.variable === "q1").map((l) => l.code)).toEqual(["q1"]);
  });
  contract("L057", "one codebook matched to two waves gets links for each file; confirming covers both", CB + " Which data file", "S2", async () => {
    const { readInstrumentItems, suggestInstrumentLinks, confirmInstrumentLinks } = await lib();
    const run = await project();
    const w1 = await stored(run, "table", "wave1.csv", dataCsv(["q1", "q2"]));
    const w2 = await stored(run, "table", "wave2.csv", dataCsv(["q1", "q2"]));
    const cb = await stored(run, "instrument", "codebook.csv", codebookCsv([{ name: "q1", label: "One", opts: YN }, { name: "q2", label: "Two", opts: YN }]));
    await readInstrumentItems(tenant, run, cb);
    await suggestInstrumentLinks(tenant, run, cb, w1);
    await suggestInstrumentLinks(tenant, run, cb, w2);
    expect(await confirmInstrumentLinks(tenant, run, cb, 0.9)).toMatchObject({ confirmed: 4 });
    expect(pairs(await links(cb, w1))).toEqual(["q1->q1:code:1:confirmed", "q2->q2:code:1:confirmed"]);
    expect(pairs(await links(cb, w2))).toEqual(["q1->q1:code:1:confirmed", "q2->q2:code:1:confirmed"]);
  });
  contract("L058", "which data file: the only one is chosen; two equal waves are a choice, never a default", CB + " Which data file (chooseMatchTarget)", "S2", async () => {
    const { readInstrumentItems, chooseMatchTarget } = await lib();
    const run = await project();
    const w1 = await stored(run, "table", "wave1.csv", dataCsv(["q1", "q2", "q3", "q4"]));
    const cb = await stored(run, "instrument", "codebook.csv", codebookCsv(["q1", "q2", "q3", "q4"].map((n) => ({ name: n, label: n, opts: YN }))));
    await readInstrumentItems(tenant, run, cb);
    expect(await chooseMatchTarget(tenant, run, cb)).toMatchObject({ kind: "chosen", dataDocumentId: w1, reason: "only" });
    await stored(run, "table", "wave2.csv", dataCsv(["q1", "q2", "q3", "q4"]));
    expect(await chooseMatchTarget(tenant, run, cb)).toMatchObject({ kind: "choose" });
  });
  contract("L059", "which data file: a clear lead (4 vs 0 items) is chosen as best", CB + " Which data file", "S3", async () => {
    const { readInstrumentItems, chooseMatchTarget } = await lib();
    const run = await project();
    await stored(run, "table", "other.csv", dataCsv(["x1", "x2"]));
    const good = await stored(run, "table", "survey.csv", dataCsv(["q1", "q2", "q3", "q4"]));
    const cb = await stored(run, "instrument", "codebook.csv", codebookCsv(["q1", "q2", "q3", "q4"].map((n) => ({ name: n, label: n, opts: YN }))));
    await readInstrumentItems(tenant, run, cb);
    expect(await chooseMatchTarget(tenant, run, cb)).toMatchObject({ kind: "chosen", dataDocumentId: good, reason: "best", matched: 4 });
  });

  // ---------------------------------------------------------------- IGS (hand reading)
  describe("IGS May 2026 (real files)", () => {
    const igs = { run: "", data: "", cb: "" };
    const hand = { names: [] as string[] };
    beforeAll(async () => {
      // The 266 names by hand reading (see run_engine.py IGS01); the data header read directly.
      const r = spawnSync(PYTHON, ["-I", "-c", `import openpyxl, json
wb = openpyxl.load_workbook(${JSON.stringify(IGS + "/May26_codebook.xlsx")})
out = []
for r in wb.active.iter_rows(min_row=2, values_only=True):
    if r[0] and r[1]:
        out += [x.strip() for x in r[0].split(",")] if "," in r[0] else [r[0].strip()]
print(json.dumps(out))`], { encoding: "utf8" });
      hand.names = JSON.parse(r.stdout);
      const { readInstrumentItems, suggestInstrumentLinks } = await lib();
      igs.run = await project();
      igs.data = await stored(igs.run, "table", "may2026.txt", readFileSync(`${IGS}/may2026.txt`));
      igs.cb = await stored(igs.run, "instrument", "May26_codebook.xlsx", readFileSync(`${IGS}/May26_codebook.xlsx`));
      await readInstrumentItems(tenant, igs.run, igs.cb);
      await suggestInstrumentLinks(tenant, igs.run, igs.cb, igs.data);
    });
    const dataNames = () => readFileSync(`${IGS}/may2026.txt`, "utf8").split("\n", 1)[0].replace(/\r$/, "").split("\t");
    contract("IGSL1", "IGS codebook stored as 266 items in hand-read order", CB + " Reading", "S2", async () => {
      expect((await items(igs.cb)).map((i) => i.code)).toEqual(hand.names);
    });
    contract("IGSL2", "IGS: each of the 264 data columns suggested for its same-named entry at 1; w2 and generation unlinked", CB + " Linking", "S1", async () => {
      const ls = await links(igs.cb, igs.data);
      const expected = dataNames().filter((n) => hand.names.includes(n)).map((n) => `${n}->${n}:code:1:suggested`).sort();
      expect(expected.length).toBe(264);
      expect(pairs(ls).sort()).toEqual(expected);
    });
    contract("IGSL3", "IGS: 'Confirm same-code matches' confirms all 264", CB + " Linking", "S2", async () => {
      const { confirmInstrumentLinks } = await lib();
      expect(await confirmInstrumentLinks(tenant, igs.run, igs.cb, 0.9)).toMatchObject({ confirmed: 264, refused: [] });
    });
    // The questionnaire is a Word file read by the model; the hand reading of its items 1A, 5A and 13 is
    // what the model is made to return (Word to text and the model's reading are not covered here).
    const Q1A = "California will be holding a statewide primary election on June 2nd.  Are you planning or not planning to vote in this election, or have you already voted early or by mail?";
    const Q5A = "Regardless of whom you supported for Governor, is your opinion of the each of the top candidates generally favorable or unfavorable, or do you not know enough about them to say? (randomize ordering)";
    contract("IGSL4", "IGS questionnaire 1A links to Q1 through the confirmed codebook entry (identical wording)", CB + " batch 49 (Grant's case)", "S2", async () => {
      const { doc } = await questionnaire(igs.run, igs.data, [
        { code: "1A", text: Q1A, options: [{ code: "1", label: "Planning to vote" }, { code: "2", label: "Not planning to vote" }, { code: "3", label: "Already voted" }], section: null },
        { code: "5A", text: Q5A, options: [{ code: "1", label: "Favorable" }, { code: "2", label: "Unfavorable" }, { code: "3", label: "Dk/no opinion" }] },
      ]);
      (igs as { q?: string }).q = doc;
      expect(pairs((await links(doc, igs.data)).filter((l) => l.code === "1A"))).toEqual(["1A->Q1:codebook:1:confirmed"]);
    });
    recorded("known", "IGSL5", "IGS questionnaire grid 5A linked to Q5_1..Q5_8", "planned batch 53 (grid detection)", async () => {
      const doc = (igs as { q?: string }).q;
      if (!doc) return { agrees: false, detail: "questionnaire not read (IGSL4 failed first)" };
      const p = pairs((await links(doc, igs.data)).filter((l) => l.code === "5A"));
      const want = Array.from({ length: 8 }, (_, k) => `Q5_${k + 1}`);
      return { agrees: want.every((w) => p.some((x) => x.startsWith(`5A->${w}:`))), detail: `5A links: ${p.join(", ") || "none"}` };
    });
  });
});
