// Codebooks (Grant, 26 October 2026) and spreadsheet questionnaires, read without the model and linked to
// a data file by variable name, through the actual readInstrumentItems, suggestInstrumentLinks,
// confirmInstrumentLinks, getLabelOverlay and loadCategories, with the local engine and a real database
// (storage is an in-memory stand-in; the model is stubbed and must never be called for these files):
//   - the Berkeley IGS Poll layout: a header whose name and label columns are swapped, a blank row,
//     section rows, "1=Democrat, 2=No Party Preference" values with commas inside labels, a row naming
//     several variables, and "as is" values; every variable links by exact name, and once confirmed the
//     data file's tables show the codebook's labels;
//   - one row per value (variable, value, value label) as CSV;
//   - JSON in three shapes;
//   - an XLSForm questionnaire (survey and choices sheets): its questions, choice lists and groups;
//   - a spreadsheet that is no codebook is refused with its reason, and nothing is stored.
// Skipped, with the reason, without a test database or python3 + pandas/openpyxl.
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
vi.mock("next/server", () => ({ after: vi.fn() }));
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

vi.setConfig({ testTimeout: 90_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, openpyxl"], { encoding: "utf8" }).status === 0;

function workbook(sheets: Record<string, (string | number | null)[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const BERKELEY = workbook({
  May26_codebook: [
    ["VARIABLE LABEL", "VARIABLE NAME", "VALUES"],
    [],
    ["ESSENTIAL VARIABLES FROM PDI RECORD"],
    ["party_reg", "Party registration", "1=Democrat, 2=No Party Preference, 3=Other Party, 4=Republican"],
    ["CNTY", "CNTY (county)", "1 thru 58 California counties coded in alphabetic order"],
    [],
    ["METADATA VARIABLES"],
    ["ID", "Identification number assigned to respondent", "as is"],
    ["w1", "Statewide weights", "as is"],
    ["white, black", "Race/ethnicity (summary)", "0=No, 1=Yes"],
    ["SURVEY ITEMS"],
    ["Q3", "Q3 For whom did you vote for Governor?", "1=Akinyemi Agbede, Party: Democratic, Mathematician, 2=Mohammad Arif, Party: Democratic, Immigrants Organizer"],
  ],
});
const DATA = Buffer.from("ID\tparty_reg\tCNTY\tw1\twhite\tblack\tQ3\n1\t1\t19\t0.9\t1\t0\t2\n2\t4\t37\t1.1\t0\t1\t1\n3\t1\t1\t1.0\t1\t0\t2\n", "utf-8");

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("codebooks and spreadsheet questionnaires (real database, actual engine)", () => {
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
    run = (await db.pool.query("insert into runs (tenant_id, project_name) values ($1, 'P') returning id", [tenant])).rows[0].id;
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  async function stored(kind: "instrument" | "table", name: string, bytes: Buffer, type: string | null = null) {
    const key = `${tenant}/${run}/${randomUUID()}-${name}`;
    storage.objects.set(key, bytes);
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, instrument_type, data_setup)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [tenant, run, kind, kind === "table" ? "raw" : null, name, key, type, kind === "table" ? JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true }) : null],
    ))[0].id as string;
  }
  const lib = () => import("../instruments");

  it("the Berkeley layout: every variable read, linked by name, and its labels used once confirmed", async () => {
    const { readInstrumentItems, getInstrumentItems, suggestInstrumentLinks, confirmInstrumentLinks, getInstrumentLinks } = await lib();
    const codebook = await stored("instrument", "May26_codebook.xlsx", BERKELEY, "codebook");
    const data = await stored("table", "may2026.txt", DATA);
    expect(await readInstrumentItems(tenant, run, codebook)).toMatchObject({ count: 7, complete: true });
    const items = await getInstrumentItems(tenant, codebook);
    expect(items.map((i) => i.code)).toEqual(["party_reg", "CNTY", "ID", "w1", "white", "black", "Q3"]);
    const party = items.find((i) => i.code === "party_reg")!;
    expect(party.text).toBe("Party registration");
    expect(party.section).toBe("ESSENTIAL VARIABLES FROM PDI RECORD");
    expect(party.options).toEqual([
      { code: "1", label: "Democrat" }, { code: "2", label: "No Party Preference" }, { code: "3", label: "Other Party" }, { code: "4", label: "Republican" },
    ]);
    // Commas inside an answer label stay in it.
    expect(items.find((i) => i.code === "Q3")!.options.map((o) => o.label)).toEqual(["Akinyemi Agbede, Party: Democratic, Mathematician", "Mohammad Arif, Party: Democratic, Immigrants Organizer"]);
    expect(items.find((i) => i.code === "CNTY")!.options).toEqual([]);
    expect(items.find((i) => i.code === "black")!.options).toEqual([{ code: "0", label: "No" }, { code: "1", label: "Yes" }]);

    await suggestInstrumentLinks(tenant, run, codebook, data);
    const links = await getInstrumentLinks(tenant, codebook);
    expect(links.filter((l) => l.method === "code" && l.confidence === 1).map((l) => l.variable).sort()).toEqual(["CNTY", "ID", "Q3", "black", "party_reg", "w1", "white"]);
    await confirmInstrumentLinks(tenant, run, codebook, 0.9);
    const { loadCategories } = await import("../crosstabs");
    const cats = (await loadCategories(tenant, run, data, "party_reg")).categories;
    expect(Object.fromEntries(cats.map((c) => [c.label, c.n]))).toMatchObject({ Democrat: 2, Republican: 1 });
  });

  it("one row per value, as CSV, and JSON in three shapes", async () => {
    const { readInstrumentItems, getInstrumentItems } = await lib();
    const long = await stored("instrument", "dictionary.csv", Buffer.from("Variable,Label,Value,Value label\ngender,Gender,1,Male\n,,2,Female\nage,Age in years,,\n", "utf-8"), "codebook");
    await readInstrumentItems(tenant, run, long);
    expect((await getInstrumentItems(tenant, long)).map((i) => [i.code, i.text, i.options.length])).toEqual([["gender", "Gender", 2], ["age", "Age in years", 0]]);
    const shapes = [
      [{ name: "q1", label: "Has an account", values: { "1": "Yes", "2": "No" } }],
      { fields: [{ name: "q1", title: "Has an account", categories: [{ value: 1, label: "Yes" }, { value: 2, label: "No" }] }] },
      { q1: { label: "Has an account", value_labels: [[1, "Yes"], [2, "No"]] } },
    ];
    for (const shape of shapes) {
      const doc = await stored("instrument", "codebook.json", Buffer.from(JSON.stringify(shape)), "codebook");
      await readInstrumentItems(tenant, run, doc);
      expect((await getInstrumentItems(tenant, doc)).map((i) => ({ code: i.code, text: i.text, options: i.options }))).toEqual([
        { code: "q1", text: "Has an account", options: [{ code: "1", label: "Yes" }, { code: "2", label: "No" }] },
      ]);
    }
  });

  it("an XLSForm questionnaire is read without the model: questions, choice lists, groups and relevance", async () => {
    const { readInstrumentItems, getInstrumentItems } = await lib();
    const form = workbook({
      survey: [["type", "name", "label::English", "relevant"], ["begin group", "hh", "Household", ""], ["select_one yn", "q1", "Do you have a bank account?", ""], ["integer", "q2", "How many accounts?", "${q1} = '1'"], ["note", "n1", "Thank you", ""], ["end group", "", "", ""], ["select_multiple ch", "q3", "Channels used", ""]],
      choices: [["list_name", "name", "label::English"], ["yn", "1", "Yes"], ["yn", "2", "No"], ["ch", "bank", "Bank"], ["ch", "mm", "Mobile money"]],
    });
    const doc = await stored("instrument", "survey_form.xlsx", form, "questionnaire");
    await readInstrumentItems(tenant, run, doc);
    const items = await getInstrumentItems(tenant, doc);
    expect(items.map((i) => [i.code, i.section, i.options.map((o) => o.label)])).toEqual([
      ["q1", "Household", ["Yes", "No"]], ["q2", "Household", []], ["q3", null, ["Bank", "Mobile money"]],
    ]);
    expect(items.find((i) => i.code === "q2")!.routingText).toBe("${q1} = '1'");
    const { anthropic } = await import("../anthropic");
    expect(anthropic.messages.create).not.toHaveBeenCalled();
  });

  it("a spreadsheet that is not a codebook is refused with its reason, and nothing is stored", async () => {
    const { readInstrumentItems, getInstrumentItems } = await lib();
    const doc = await stored("instrument", "notes.xlsx", workbook({ Notes: [["Fieldwork ran in May."], ["Weights were raked."]] }), "codebook");
    await expect(readInstrumentItems(tenant, run, doc)).rejects.toThrow(/No codebook table was found/);
    expect(await getInstrumentItems(tenant, doc)).toEqual([]);
  });
});
