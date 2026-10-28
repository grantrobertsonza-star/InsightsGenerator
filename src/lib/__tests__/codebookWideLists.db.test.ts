// Answer lists and names in a wide codebook (one row per variable, "1=Yes, 2=No" in a cell), after
// Codex's import stress review (27 October 2026), through the actual readInstrumentItems,
// suggestInstrumentLinks, confirmInstrumentLinks, loadCategories and buildCrosstab, with the local engine
// and a real disposable PostgreSQL (storage is an in-memory stand-in; the model is stubbed and never
// called). Expected values are counted from the source bytes written here, never from the app.
//   IS-F02 (S1): raw answers 01, 01, 1, 2 with "01=Refused, 2=Yes": only the two 01 answers are a
//     non-answer, so the base is 2 and Yes is 1/2 = 50% (before: "01" became "1", base 3, 33.3%). The
//     same codebook as JSON gives the same table; a large integer code is not rounded.
//   IS-F04 (S2): text codes (AA=Yes, A_B / C-D) and "1e0" are read as answers; a label in quotation
//     marks keeps its comma; a list that has "=" but cannot be read makes the read incomplete (named, not
//     silently empty), and the corrected file then reads completely; "as is" is still not a list.
//   IS-F05 (S2): names the data reader accepts ("Age years", "回答", "_Q1", "123") are read, linked and
//     labelled; a section heading is still a section, not a variable.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as XLSX from "xlsx";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "controlled", anthropic: { messages: { create: vi.fn(async () => { throw new Error("test: no model call expected"); }) } } }));

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

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat, openpyxl"], { encoding: "utf8" }).status === 0;
const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n") + "\n", "utf-8");
const workbook = (rows: string[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Codebook");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("answer lists and names in a wide codebook (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  let run = "";
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await db.pool.query("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  // Each case is its own project, so one codebook never labels another case's data file.
  async function project() {
    run = (await q("insert into runs (tenant_id, project_name) values ($1, 'P') returning id", [tenant]))[0].id;
  }
  async function stored(kind: "instrument" | "table", name: string, bytes: Buffer) {
    const key = `${tenant}/${run}/${randomUUID()}-${name}`;
    storage.objects.set(key, bytes);
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, instrument_type, data_setup)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [tenant, run, kind, kind === "table" ? "raw" : null, name, key, kind === "instrument" ? "codebook" : null, kind === "table" ? JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true }) : null],
    ))[0].id as string;
  }
  const lib = () => import("../instruments");
  async function readAndConfirm(codebook: string, data: string) {
    const { readInstrumentItems, suggestInstrumentLinks, confirmInstrumentLinks } = await lib();
    const read = await readInstrumentItems(tenant, run, codebook);
    await suggestInstrumentLinks(tenant, run, codebook, data);
    await confirmInstrumentLinks(tenant, run, codebook, 0.9);
    return read;
  }
  const optionCodes = async (codebook: string, code: string) => (await (await lib()).getInstrumentItems(tenant, codebook)).find((i) => i.code === code)?.options.map((o) => [o.code, o.label]);
  const categories = async (data: string, variable: string) => {
    const { loadCategories } = await import("../crosstabs");
    return Object.fromEntries((await loadCategories(tenant, run, data, variable)).categories.map((c) => [c.label, c.n]));
  };
  /** The saved table of one question for everyone: its base and the share answering "Yes". */
  async function yesShare(data: string, variable: string) {
    const { buildCrosstab } = await import("../crosstabs");
    const built = await buildCrosstab(tenant, run, data, { columnVars: [], rowItems: [{ key: variable, label: variable, vars: [variable] }], weightVar: null, correction: "none" });
    const t = (await q("select crosstab from document_tables where id = $1", [built.tableId]))[0].crosstab;
    const rows = t.questions[0].rows as { label: string; isBase?: boolean; total: { pct: number | null; base: { n: number } } }[];
    const yes = rows.find((r) => r.label === "Yes")!;
    return { base: yes.total.base.n, yes: yes.total.pct };
  }
  const DATA_01 = () => Buffer.from("id,q1\n1,01\n2,01\n3,1\n4,2\n", "utf-8");

  it("IS-F02: 01=Refused leaves only the 01 answers out of the base: base 2, Yes 50%, in CSV, Excel and JSON alike", async () => {
    const wide = [["Variable", "Label", "Values"], ["id", "Respondent", "as is"], ["q1", "Would you recommend us?", "01=Refused, 2=Yes"]];
    for (const [name, bytes] of [
      ["cb.csv", csv(wide)],
      ["cb.xlsx", workbook(wide)],
      ["cb.json", Buffer.from(JSON.stringify([{ name: "q1", label: "Would you recommend us?", values: { "01": "Refused", "2": "Yes" } }]))],
    ] as const) {
      await project();
      const data = await stored("table", "poll.csv", DATA_01());
      const cb = await stored("instrument", name, bytes);
      expect(await readAndConfirm(cb, data), name).toMatchObject({ complete: true });
      // Sorted: JSON object keys that look like whole numbers come first in JavaScript's own key order.
      expect((await optionCodes(cb, "q1"))!.sort(), name).toEqual([["01", "Refused"], ["2", "Yes"]]);
      // Raw "1" has no label in this codebook, so it stays as answered; the two "01" answers are Refused.
      expect(await categories(data, "q1"), name).toEqual({ Refused: 2, "1": 1, Yes: 1 });
      expect(await yesShare(data, "q1"), name).toEqual({ base: 2, yes: 50 });
    }
  });

  it("IS-F02: a large integer code keeps its digits, and two codes one apart stay two codes", async () => {
    await project();
    const cb = await stored("instrument", "big.csv", csv([["Variable", "Label", "Values"], ["id", "Respondent", "as is"], ["big", "Account", "9007199254740993=A, 9007199254740992=B"]]));
    await (await lib()).readInstrumentItems(tenant, run, cb);
    expect(await optionCodes(cb, "big")).toEqual([["9007199254740993", "A"], ["9007199254740992", "B"]]);
  });

  it("IS-F04: text and exponent codes are answers, a quoted label keeps its comma, and an unreadable list is reported, then recovered", async () => {
    await project();
    const data = await stored("table", "grades.csv", Buffer.from("id,q2,q3,q4\n1,AA,A_B,1e0\n2,BB,C-D,1\n3,AA,A_B,x\n", "utf-8"));
    const rows = [
      ["Variable", "Label", "Values"],
      ["id", "Respondent", "as is"],
      ["q2", "Grade", "AA=Yes, BB=No"],
      ["q3", "Band", 'A_B="Low, or none", C-D=High'],
      ["q4", "Spelling", "1e0=Exponent, 1=Integer"],
    ];
    expect(await readAndConfirm(await stored("instrument", "text.csv", csv(rows)), data)).toMatchObject({ complete: true, incompleteItems: 0 });
    expect(await categories(data, "q2")).toEqual({ Yes: 2, No: 1 });
    expect(await categories(data, "q3")).toEqual({ "Low, or none": 2, High: 1 });
    // q4 holds text ("x"), so "1e0" and "1" are two answers; on a numeric column they would be one value
    // and two labels for it a conflict (B36-F01).
    expect(await categories(data, "q4")).toEqual({ Exponent: 1, Integer: 1, x: 1 });

    // An "=" list that cannot be read: the item is kept, the read says it is incomplete (before: complete).
    await project();
    const broken = [["Variable", "Label", "Values"], ["id", "Respondent", "as is"], ["q2", "Grade", "=Yes, BB No"], ["q5", "Other", "1=Yes 2=No"]];
    const cb = await stored("instrument", "broken.csv", csv(broken));
    expect(await (await lib()).readInstrumentItems(tenant, run, cb)).toMatchObject({ complete: false, incompleteItems: 2 });
    expect(await optionCodes(cb, "q2")).toEqual([]);
    // Corrected and read again: complete, with the answers. A stored file never changes in place (the
    // engine's download cache is keyed by its path), so the corrected file gets a path of its own.
    const fixedKey = `${tenant}/${run}/${randomUUID()}-broken.csv`;
    storage.objects.set(fixedKey, csv([["Variable", "Label", "Values"], ["id", "Respondent", "as is"], ["q2", "Grade", "AA=Yes, BB=No"], ["q5", "Other", "1=Yes, 2=No"]]));
    await q("update documents set storage_path = $2 where id = $1", [cb, fixedKey]);
    expect(await (await lib()).readInstrumentItems(tenant, run, cb)).toMatchObject({ complete: true, incompleteItems: 0 });
    expect(await optionCodes(cb, "q2")).toEqual([["AA", "Yes"], ["BB", "No"]]);
  });

  it("IS-F05: names the data file accepts are read, linked and labelled; a section heading stays a section", async () => {
    await project();
    const data = await stored("table", "names.csv", Buffer.from("id,Age years,回答,_Q1,123\n1,1,1,1,1\n2,2,2,2,2\n", "utf-8"));
    const rows = [
      ["Variable", "Label", "Values"],
      ["id", "Respondent", "as is"],
      ["Demographic questions"],
      ["Age years", "Age group", "1=Under 35, 2=35 or over"],
      ["回答", "Answer", "1=はい, 2=いいえ"],
      ["_Q1", "First", "1=Yes, 2=No"],
      ["123", "Numbered", "1=Yes, 2=No"],
    ];
    const cb = await stored("instrument", "names.csv", csv(rows));
    expect(await readAndConfirm(cb, data)).toMatchObject({ complete: true, count: 5 });
    const items = await (await lib()).getInstrumentItems(tenant, cb);
    expect(items.map((i) => i.code)).toEqual(["id", "Age years", "回答", "_Q1", "123"]);
    expect(items.find((i) => i.code === "Age years")!.section).toBe("Demographic questions");
    expect(await categories(data, "Age years")).toEqual({ "Under 35": 1, "35 or over": 1 });
    expect(await categories(data, "回答")).toEqual({ はい: 1, いいえ: 1 });
    expect(await categories(data, "123")).toEqual({ Yes: 1, No: 1 });
  });

  // IS-F07 (Codex, 28 October 2026): "VARIABLE NAME,LABEL,VALUES" over "q_2028,Satisfaction,..." was read as a
  // variable "LABEL" and a variable "Satisfaction" (the label taken for the name), and with a data column of
  // that name the codebook's answers were confirmed onto Satisfaction; q_2028 was not linked.
  it("IS-F07: the header row is never a variable, and the codebook's answers label q_2028, not Satisfaction", async () => {
    await project();
    const data = await stored("table", "poll.csv", Buffer.from("id,q_2028,Satisfaction\n1,7,1\n2,8,2\n3,7,1\n", "utf-8"));
    for (const [name, bytes] of [
      ["header.csv", csv([["VARIABLE NAME", "LABEL", "VALUES"], ["q_2028", "Satisfaction", "7=First, 8=Second"]])],
      ["header.xlsx", workbook([["VARIABLE NAME", "LABEL", "VALUES"], ["q_2028", "Satisfaction", "7=First, 8=Second"]])],
    ] as const) {
      await q("delete from instrument_links where run_id = $1", [run]);
      const cb = await stored("instrument", name, bytes);
      expect(await readAndConfirm(cb, data), name).toMatchObject({ complete: true, count: 1 });
      expect((await (await lib()).getInstrumentItems(tenant, cb)).map((i) => [i.code, i.text]), name).toEqual([["q_2028", "Satisfaction"]]);
      expect((await q("select l.variable, l.status from instrument_links l join instrument_items i on i.id = l.item_id where i.document_id = $1", [cb])).map((l) => `${l.variable}:${l.status}`), name).toEqual(["q_2028:confirmed"]);
      expect(await categories(data, "q_2028"), name).toEqual({ First: 2, Second: 1 });
      expect(await categories(data, "Satisfaction"), name).toEqual({ "1": 2, "2": 1 });
    }
  });

  it("IS-F07 boundaries: one variable under a multiword header (CSV and Excel), two variables, a title above the header, and no header", async () => {
    const { readInstrumentItems, getInstrumentItems } = await lib();
    await project();
    const label = "How satisfied are you with the service you received today?";
    const cases: [string, Buffer, string[]][] = [
      ["one.csv", csv([["VARIABLE NAME", "VARIABLE LABEL", "VALUES"], ["q1", label, "1=Yes, 2=No"]]), ["q1"]],
      ["one.xlsx", workbook([["VARIABLE NAME", "VARIABLE LABEL", "VALUES"], ["q1", label, "1=Yes, 2=No"]]), ["q1"]],
      ["two.csv", csv([["VARIABLE NAME", "VARIABLE LABEL", "VALUES"], ["q1", label, "1=Yes, 2=No"], ["q2", "Age group", "1=Young, 2=Old"]]), ["q1", "q2"]],
      ["titled.csv", csv([["Survey 2026 codebook", "", ""], ["VARIABLE NAME", "VARIABLE LABEL", "VALUES"], ["q1", label, "1=Yes, 2=No"]]), ["q1"]],
      ["headerless.csv", csv([["q1", label, "1=Yes, 2=No"], ["q2", "Age group", "1=Young, 2=Old"], ["q3", "Region of residence", "1=North, 2=South"]]), ["q1", "q2", "q3"]],
    ];
    for (const [name, bytes, codes] of cases) {
      const cb = await stored("instrument", name, bytes);
      expect(await readInstrumentItems(tenant, run, cb), name).toMatchObject({ complete: true });
      const items = await getInstrumentItems(tenant, cb);
      expect(items.map((i) => i.code), name).toEqual(codes);
      expect(items[0].text, name).toBe(label);
    }
  });
});
