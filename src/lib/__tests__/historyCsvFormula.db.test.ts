// Codex RR-F07 (2026-10-23): the history CSV keeps a finding's text as text. The actual export route
// runs against a real disposable database; its bytes are opened by a real spreadsheet (headless
// LibreOffice) and read back: a formula-leading finding is a text cell with no formula, its words
// unchanged after the leading apostrophe, and ordinary text with commas, quotes and line breaks
// keeps its columns.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { csvField } from "../csvField";

vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("@/lib/csvField", async () => await import("../csvField"));
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

const SOFFICE = process.env.LIBREOFFICE_PATH ?? "/usr/bin/soffice";

describe("csvField", () => {
  it("neutralises formula-leading text and quotes structure characters", () => {
    expect(csvField("=1+1")).toBe("'=1+1");
    expect(csvField("+27 82 000")).toBe("'+27 82 000");
    expect(csvField("-negative framing")).toBe("'-negative framing");
    expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvField("  =HYPERLINK(\"x\")")).toBe(`"'  =HYPERLINK(""x"")"`);
    expect(csvField("\tTabbed")).toBe("'\tTabbed");
    expect(csvField("Plain, with \"quotes\"\nand a break")).toBe(`"Plain, with ""quotes""\nand a break"`);
    expect(csvField("Price rose 5% = a problem")).toBe("Price rose 5% = a problem");
  });
});

describe.skipIf(!TEST_DATABASE_URL)("history CSV in a real spreadsheet (real database, actual route)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string;
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic CSV')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'CSV check') returning id", [tenant])).rows[0].id;
    const add = (text: string, at: string) =>
      db.pool.query(
        "insert into finding_history(tenant_id,run_id,original_finding_id,finding_text,status,archived_reason,original_created_at,archived_at) values($1,$2,$3,$4,'rejected','manual_reextract',now(),$5)",
        [tenant, run, randomUUID(), text, at],
      );
    await add("=1+1", "2026-10-23T10:00:03Z");
    await add("Plain, with \"quotes\"\nand a break", "2026-10-23T10:00:02Z");
    await add("@SUM(1,2)", "2026-10-23T10:00:01Z");
  }, 120000);
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end();
    await db.drop();
  });

  it.skipIf(!existsSync(SOFFICE))("formula-leading findings open as text cells, ordinary text keeps its columns", async () => {
    const { GET } = await import("../../app/api/runs/[id]/history/export/route");
    const res = await GET(new Request("http://test/"), { params: Promise.resolve({ id: run }) });
    expect(res.status).toBe(200);
    const dir = mkdtempSync(path.join(tmpdir(), "history-csv-"));
    try {
      const csvPath = path.join(dir, "history.csv");
      writeFileSync(csvPath, Buffer.from(await res.arrayBuffer()));
      execFileSync(SOFFICE, ["--headless", `-env:UserInstallation=file://${dir}/profile`, "--convert-to", "xlsx", "--outdir", dir, csvPath], { timeout: 120000 });
      const wb = XLSX.read(readFileSync(path.join(dir, "history.xlsx")), { type: "buffer", cellFormula: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const cell = (ref: string) => sheet[ref] as XLSX.CellObject | undefined;
      // Newest first: "=1+1", then the quoted text, then "@SUM(1,2)".
      for (const ref of ["A2", "A4"]) {
        expect(cell(ref)?.f, ref).toBeUndefined();
        expect(cell(ref)?.t, ref).toBe("s");
      }
      expect(String(cell("A2")?.v)).toMatch(/^'?=1\+1$/);
      expect(String(cell("A4")?.v)).toMatch(/^'?@SUM\(1,2\)$/);
      expect(cell("A3")?.v).toBe("Plain, with \"quotes\"\nand a break");
      expect(cell("B3")?.v).toBe("Rejected");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180000);
});
