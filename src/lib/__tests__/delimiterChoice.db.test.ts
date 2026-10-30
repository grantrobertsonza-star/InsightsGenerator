// IS-F01 (Codex import stress review, 27 October 2026): a valid short row made a semicolon file import
// as one text column, because the separator guess fell back to a comma. Through the actual
// extractAndStoreDocumentTables and loadCategories, reading through api/parse-stats-file.py (local engine
// runner), on a real disposable PostgreSQL; storage is an in-memory stand-in and the model is stubbed.
// Expected values are written out from the source bytes here, never taken from the app.
//   - Codex's exact source (semicolons, row 2 short): headers a, b, c; row 2 is 4, 5, missing.
//   - The same shape with pipes, and tabs in a .csv; a .tsv control; a quoted separator; a trailing
//     empty value; a decimal comma inside semicolon data; a genuinely single-column file.
//   - A surplus non-empty value is refused with its line and nothing is stored (before: one column).
//   - Two separators that both read as a complete table are refused, never guessed; the corrected
//     file then imports, and reading Codex's file again gives the same table.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
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
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat"], { encoding: "utf8" }).status === 0;
type Row = Record<string, string | number | boolean | null>;

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("the separator of a delimited file (real database, actual engine)", () => {
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

  async function file(name: string, text: string) {
    const key = `${tenant}/${run}/${randomUUID()}-${name}`;
    storage.objects.set(key, Buffer.from(text, "utf-8"));
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
       values ($1, $2, 'table', 'raw', $3, $4, $5) returning id`,
      [tenant, run, name, key, JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true })],
    ))[0].id as string;
  }
  async function imported(doc: string): Promise<{ headers: string[]; rows: Row[] }> {
    const { extractAndStoreDocumentTables } = await import("../documentTables");
    await extractAndStoreDocumentTables(tenant, run, doc);
    const t = (await q("select headers, rows from document_tables where document_id = $1 and table_index = 0", [doc]))[0];
    return { headers: t.headers, rows: t.rows };
  }
  const stored = async (doc: string) => (await q("select 1 from document_tables where document_id = $1", [doc])).length;
  const categories = async (doc: string, variable: string) => {
    const { loadCategories } = await import("../crosstabs");
    return Object.fromEntries((await loadCategories(tenant, run, doc, variable)).categories.map((c) => [c.label, c.n]));
  };
  const SHORT_ROW = [{ a: 1, b: 2, c: 3 }, { a: 4, b: 5, c: null }, { a: 6, b: 7, c: 8 }];

  it("Codex's source: semicolons with a short row read as three columns, the short row padded", async () => {
    const doc = await file("short.csv", "a;b;c\n1;2;3\n4;5\n6;7;8\n");
    const t = await imported(doc);
    expect(t.headers).toEqual(["a", "b", "c"]);
    expect(t.rows).toEqual(SHORT_ROW);
    // c holds a missing value, so it is read as decimal numbers; its whole-number codes are still listed as "3" and
    // "8" (batch 55, L3 D8).
    expect(await categories(doc, "c")).toEqual({ "3": 1, "8": 1 });
    // Reading it again gives the same table.
    expect(await imported(doc)).toEqual(t);
  });

  it("pipes and tabs in a .csv with a short row, and a .tsv control, read the same way", async () => {
    for (const [name, text] of [
      ["pipe.csv", "a|b|c\n1|2|3\n4|5\n6|7|8\n"],
      ["tab.csv", "a\tb\tc\n1\t2\t3\n4\t5\n6\t7\t8\n"],
      ["tab.tsv", "a\tb\tc\n1\t2\t3\n4\t5\n6\t7\t8\n"],
    ]) {
      const t = await imported(await file(name, text));
      expect(t.headers, name).toEqual(["a", "b", "c"]);
      expect(t.rows, name).toEqual(SHORT_ROW);
    }
  });

  it("a quoted separator, a trailing empty value and decimal commas stay inside their cells", async () => {
    const quoted = await imported(await file("quoted.csv", 'a;b\n"x;y";2\n3;4\n'));
    // a holds text ("x;y"), so its other value keeps its literal spelling.
    expect(quoted.rows).toEqual([{ a: "x;y", b: 2 }, { a: "3", b: 4 }]);
    const trailing = await imported(await file("trailing.csv", "a;b\n1;2;\n3;4\n"));
    expect(trailing.headers).toEqual(["a", "b"]);
    expect(trailing.rows).toEqual([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
    const decimals = await imported(await file("decimals.csv", "score;group\n1,5;x\n2,5;y\n"));
    expect(decimals.headers).toEqual(["score", "group"]);
    expect(decimals.rows.map((r) => r.group)).toEqual(["x", "y"]);
  });

  it("a genuinely single-column file is still one column", async () => {
    const t = await imported(await file("one.csv", "score\n1\n2\n3\n"));
    expect(t.headers).toEqual(["score"]);
    expect(t.rows).toEqual([{ score: 1 }, { score: 2 }, { score: 3 }]);
  });

  it("a surplus value is refused with its line, and nothing is stored", async () => {
    for (const [name, text] of [
      ["surplus-semi.csv", "a;b;c\n1;2;3\n4;5;6;7\n"],
      ["surplus-pipe.csv", "a|b|c\n1|2|3\n4|5\n6|7|8|9\n"],
    ]) {
      const doc = await file(name, text);
      await expect(imported(doc), name).rejects.toThrow(/Line \d+ of this CSV file has 4 values but its header row has 3 columns/);
      expect(await stored(doc), name).toBe(0);
    }
  });

  it("two separators that both read as a complete table are refused, and the corrected file imports", async () => {
    const doc = await file("either.csv", "a,b;c\n1,2;3\n");
    await expect(imported(doc)).rejects.toThrow(/could be separated by commas or by semicolons, and both read as a complete table/);
    expect(await stored(doc)).toBe(0);
    const fixed = await imported(await file("either-fixed.csv", "a;b;c\n1;2;3\n"));
    expect(fixed.rows).toEqual([{ a: 1, b: 2, c: 3 }]);
  });
});
