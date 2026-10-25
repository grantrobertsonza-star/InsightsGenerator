// Stored preview identity (importPreviewIdentity.ts) through the ACTUAL engine reader (the one reader,
// batch 26): a stored CSV/Excel table is shown only when it is what the file holds under its persisted
// sheet and layout. A table recorded as read by the current engine reader under that sheet and layout is
// shown after a structural check, with no read; any other (read by the retired TypeScript reader, an
// earlier engine reader, before migration 0116, or under another sheet or layout) is compared with a
// fresh read. Mocked: the database read of the document row and storage (an in-memory workbook or CSV).
// Skipped without python3 + pandas/openpyxl/pyreadstat.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PYTHON } from "./helpers/pythonEngine";
vi.mock("../db", () => ({ withTenantRead: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: { storage: { from: vi.fn() } } }));
import { withTenantRead } from "../db";
import { supabaseAdmin } from "../supabaseAdmin";
import { ENGINE_TABLE_READER, loadImportPreviewIdentities } from "../importPreviewIdentity";

vi.setConfig({ testTimeout: 30000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, openpyxl, pyreadstat"], { encoding: "utf8" }).status === 0;

type Doc = { id: string; kind: string; source_filename: string; storage_path: string; selected_sheet: string | null; ingestion_type: string | null };
let document: Doc;
let fileBytes: Buffer;
const download = vi.fn();
const workbook = () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Q", "ID"], [1, "001"], [2, "002"]]), "Dense");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Other"], [99]]), "Sparse");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};
// What the file holds: zero-padded identifiers stay text.
const stored = () => [{ document_id: "doc", table_index: 0, headers: ["Q", "ID"], rows: [{ Q: 1, ID: "001" }, { Q: 2, ID: "002" }], row_count: 2 } as {
  document_id: string; table_index: number; headers: string[]; rows: Record<string, string | number | null>[]; row_count: number; read_provenance?: unknown;
}];
beforeEach(() => {
  vi.clearAllMocks();
  // A path of its own per test: the local engine runner keeps a download by path for a few minutes.
  document = { id: "doc", kind: "table", source_filename: "fixture.xlsx", storage_path: `${randomUUID()}/${randomUUID()}/f`, selected_sheet: "Dense", ingestion_type: "aggregated" };
  fileBytes = workbook();
  vi.mocked(withTenantRead).mockImplementation(async (_t, fn) => fn({ query: async () => ({ rows: [document] }) } as never));
  download.mockImplementation(async () => ({ data: { arrayBuffer: async () => fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength) }, error: null }));
  vi.mocked(supabaseAdmin.storage.from).mockReturnValue({ download } as never);
});

describe.skipIf(!PYTHON_OK)("stored preview identity through the actual engine reader", () => {
  const check = async (tables = stored()) => (await loadImportPreviewIdentities("tenant", "run", tables)).get("doc");
  const current = { reader: ENGINE_TABLE_READER, sheet: "Dense", layout: "rows_are_cases", encoding: null, dateColumns: [] };

  it("a table without provenance (the retired reader's) is compared with a fresh read: matching values are shown", async () => {
    expect(await check()).toEqual({ error: null });
    expect(download).toHaveBeenCalledTimes(1);
  });
  it("one the retired reader stored differently (a code read as a number) is withheld, with the way to recover", async () => {
    const t = stored(); t[0].rows[0].ID = 1;
    const r = await check(t);
    expect(r?.error).toMatch(/differs from what the file's selected sheet "Dense" holds now/);
    expect(r?.error).toMatch(/Read the file again/);
  });
  it("a table recorded as the current reader's read of this sheet and layout is shown without reading the file", async () => {
    const t = stored(); t[0].read_provenance = current;
    expect(await check(t)).toEqual({ error: null });
    expect(download).not.toHaveBeenCalled();
  });
  it("current provenance does not excuse a damaged row: a missing own value is refused", async () => {
    const t = stored(); t[0].read_provenance = current; delete (t[0].rows[1] as Record<string, unknown>).ID;
    expect((await check(t))?.error).toMatch(/missing a value/);
  });
  it("an earlier reader, another sheet or another layout in the provenance means a fresh read", async () => {
    for (const p of [{ ...current, reader: "engine-plain-older" }, { ...current, sheet: "Sparse" }, { ...current, layout: "columns_are_cases" }]) {
      download.mockClear();
      document.storage_path = `${randomUUID()}/${randomUUID()}/f`;
      const t = stored(); t[0].read_provenance = p;
      expect(await check(t)).toEqual({ error: null });
      expect(download).toHaveBeenCalledTimes(1);
    }
  });
  it("refuses a missing sheet even when cached rows and a dictionary still exist", async () => {
    document.selected_sheet = "Removed"; expect((await check())?.error).toMatch(/Removed.*no longer exists/);
  });
  it("refuses an unconfirmed selection without publishing or reading an arbitrary sheet", async () => {
    document.selected_sheet = null; expect((await check())?.error).toContain("no confirmed data sheet"); expect(download).not.toHaveBeenCalled();
  });
  it("rejects cached rows from a different still-existing sheet", async () => {
    document.selected_sheet = "Sparse"; expect((await check())?.error).toContain('differs from what the file\'s selected sheet "Sparse" holds now');
  });
  it("surfaces a storage failure and recovers on a subsequent read", async () => {
    download.mockResolvedValueOnce({ data: null, error: { message: "Synthetic storage outage" } });
    expect((await check())?.error).toMatch(/Synthetic storage outage.*Read the file again/);
    expect(await check()).toEqual({ error: null });
  });
  it("fails visibly when source identity cannot be read", async () => {
    vi.mocked(withTenantRead).mockRejectedValueOnce(Error("permission denied")); expect((await check())?.error).toContain("permission denied");
  });
  it("a CSV is checked too: codes the retired reader turned into numbers are withheld, the engine's own read is shown", async () => {
    document.source_filename = "fixture.csv"; document.selected_sheet = null;
    fileBytes = Buffer.from('Q,ID\n1,"001"\n2,"002"\n', "utf-8");
    const old = stored(); old[0].rows = [{ Q: 1, ID: 1 }, { Q: 2, ID: 2 }];
    expect((await check(old))?.error).toMatch(/differs from what the file holds now/);
    expect(await check()).toEqual({ error: null });
  });
  it("does not read a report's preview", async () => {
    document.kind = "report"; document.source_filename = "fixture.pdf"; expect(await check()).toBeUndefined(); expect(download).not.toHaveBeenCalled();
  });
});
