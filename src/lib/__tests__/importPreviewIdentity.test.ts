import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
vi.mock("../db", () => ({ withTenantRead: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: { storage: { from: vi.fn() } } }));
import { withTenantRead } from "../db";
import { supabaseAdmin } from "../supabaseAdmin";
import { loadImportPreviewIdentities } from "../importPreviewIdentity";

const doc = { id: "doc", kind: "table", source_filename: "fixture.xlsx", storage_path: "synthetic", selected_sheet: "Dense" as string | null };
const tables = [{ document_id: "doc", table_index: 0, headers: ["Q", "ID"], rows: [{ Q: 1, ID: "001" }, { Q: 2, ID: "002" }], row_count: 2 }];
let document: typeof doc;
const download = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); document = { ...doc };
  vi.mocked(withTenantRead).mockImplementation(async (_t, fn) => fn({ query: async () => ({ rows: [document] }) } as never));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Q", "ID"], [1, "001"], [2, "002"]]), "Dense");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Other"], [99]]), "Sparse");
  const bytes = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  download.mockResolvedValue({ data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, error: null });
  vi.mocked(supabaseAdmin.storage.from).mockReturnValue({ download } as never);
});

describe("cached workbook preview identity through the actual parser", () => {
  const check = async () => (await loadImportPreviewIdentities("tenant", "run", tables)).get("doc");
  it("matches the persisted sheet and displayed values, preserving zero-padded IDs", async () => {
    expect(await check()).toEqual({ error: null }); expect(download).toHaveBeenCalledTimes(1);
  });
  it("refuses a missing sheet even when cached rows and a dictionary still exist", async () => {
    document.selected_sheet = "Removed"; expect((await check())?.error).toMatch(/Removed.*no longer exists/);
  });
  it("refuses an unconfirmed selection without publishing or reading an arbitrary sheet", async () => {
    document.selected_sheet = null; expect((await check())?.error).toContain("no confirmed data sheet"); expect(download).not.toHaveBeenCalled();
  });
  it("rejects cached rows from a different still-existing sheet", async () => {
    document.selected_sheet = "Sparse"; expect((await check())?.error).toContain("differs from selected sheet");
  });
  it("surfaces a storage failure and recovers on a subsequent read", async () => {
    download.mockResolvedValueOnce({ data: null, error: { message: "Synthetic storage outage" } });
    expect((await check())?.error).toMatch(/Retry by reloading/); expect(await check()).toEqual({ error: null });
  });
  it("fails visibly when source identity cannot be read", async () => {
    vi.mocked(withTenantRead).mockRejectedValueOnce(Error("permission denied")); expect((await check())?.error).toContain("permission denied");
  });
  it("does not download or reinterpret CSV/PDF previews", async () => {
    document.source_filename = "fixture.csv"; expect(await check()).toBeUndefined(); expect(download).not.toHaveBeenCalled();
  });
});
