// P2a repair, IMP-002 / IMP-SHIP-001 (raw preview authority). Exercises the ACTUAL
// getDocumentPreviewUrl server action with the ACTUAL parseTableDocument and
// resolveAuthoritativeSheet underneath. Mocked boundaries only: the database wrapper (a fake
// client holding one documents row), Supabase storage (serves an in-memory workbook), and the
// model/stats modules crosstabs.ts imports at its top level but this path never calls.
//
// What this does NOT establish: real PostgreSQL blocking between two clients (the P2a
// core-state-h two-client fixture) - here the competing publication is modelled as already
// committed between this read of `documents` and its own conditional UPDATE, which is the
// interleaving that fixture produces once the holder commits.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

vi.mock("../db", () => ({ withTenant: vi.fn(), withTenantRead: vi.fn() }));
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: { storage: { from: vi.fn() } } }));
vi.mock("../anthropic", () => ({ anthropic: {}, CLAUDE_MODEL: "test-model" }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn() }));
vi.mock("../parseStatsFile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../parseStatsFile")>();
  return { ...actual, runStatsTool: vi.fn() };
});

import { withTenant } from "../db";
import { supabaseAdmin } from "../supabaseAdmin";
// G6: actions and routes take the tenant from the signed-in request; tests supply the seeded one.
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());

vi.setConfig({ testTimeout: 20000 });

const RUN = "run-1";
const DOC = "doc-1";

/** Sparse: 10 columns, 1 real row, formatted far down. Dense: 2 columns, 10 real rows.
 *  The same shape as the P2a Sparse/Dense fixture: the ranking rule picks Dense. */
function sparseDenseBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const sparseRows: string[][] = [Array.from({ length: 10 }, (_, i) => `Col${i + 1}`)];
  sparseRows.push(Array.from({ length: 10 }, (_, i) => `v${i + 1}`));
  const sparse = XLSX.utils.aoa_to_sheet(sparseRows);
  sparse["!ref"] = "A1:J101";
  for (let r = 3; r <= 101; r++) {
    for (let c = 1; c <= 10; c++) sparse[XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })] = { t: "z", z: "0.00" };
  }
  XLSX.utils.book_append_sheet(wb, sparse, "Sparse");
  const denseRows: (string | number)[][] = [["A", "B"]];
  for (let r = 2; r <= 11; r++) denseRows.push([`row${r}`, r * 10]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(denseRows), "Dense");
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

function csvBuffer(): ArrayBuffer {
  const out = Buffer.from("RespondentID,Q1\n001,1\n002,0\n", "utf-8");
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

type Doc = { selected_sheet: string | null; source_filename: string };
type World = {
  doc: Doc;
  writes: unknown[][];
  downloads: number;
  /** Runs right after this call's own read of the documents row: models another reader's
   *  publication committing in between. */
  afterDocumentRead?: () => void;
  failUpdate?: Error;
};

let world: World;

function install(buffer: ArrayBuffer, doc: Doc) {
  world = { doc, writes: [], downloads: 0 };
  vi.mocked(supabaseAdmin.storage.from).mockReturnValue({
    download: async () => {
      world.downloads++;
      return { data: { arrayBuffer: async () => buffer }, error: null };
    },
  } as never);
  vi.mocked(withTenant).mockImplementation((async (_tenant: string, cb: (c: unknown) => unknown) =>
    cb({
      query: async (sql: string, params: unknown[] = []) => {
        const s = sql.replace(/\s+/g, " ").trim().toLowerCase();
        if (s.startsWith("select preview_storage_path")) {
          expect(params).toEqual([DOC, RUN]);
          const row = {
            preview_storage_path: null,
            source_filename: world.doc.source_filename,
            storage_path: "tenant/doc-1",
            kind: "table",
            selected_sheet: world.doc.selected_sheet,
          };
          world.afterDocumentRead?.();
          return { rows: [row] };
        }
        if (s.startsWith("update documents set selected_sheet")) {
          world.writes.push(params);
          if (world.failUpdate) throw world.failUpdate;
          const [resolved] = params as [string];
          if (world.doc.selected_sheet === null) {
            world.doc.selected_sheet = resolved;
            return { rows: [{ selected_sheet: resolved }] };
          }
          return { rows: [] };
        }
        if (s.startsWith("select selected_sheet from documents")) {
          return { rows: [{ selected_sheet: world.doc.selected_sheet }] };
        }
        throw new Error("unhandled query: " + sql);
      },
    })) as never);
}

async function preview() {
  const { getDocumentPreviewUrl } = await import("../previewActions");
  return getDocumentPreviewUrl(RUN, { sourceDocumentId: DOC, sourceTableId: null });
}

beforeEach(() => {
  vi.mocked(withTenant).mockReset();
  vi.mocked(supabaseAdmin.storage.from).mockReset();
});

describe("raw preview authority (P2a, IMP-002 / IMP-SHIP-001)", () => {
  it("reproduction: a competing Sparse publication committed after this read is adopted and reparsed, never the preview's own Dense pick", async () => {
    install(sparseDenseBuffer(), { selected_sheet: null, source_filename: "sparse-dense.xlsx" });
    world.afterDocumentRead = () => {
      world.doc.selected_sheet = "Sparse";
    };
    const r = await preview();
    if (!("kind" in r) || r.kind !== "table") throw new Error("expected a table: " + JSON.stringify(r));
    expect(r.table.sheetName).toBe("Sparse");
    expect(r.table.headers).toEqual(Array.from({ length: 10 }, (_, i) => `Col${i + 1}`));
    expect(r.table.rows).toHaveLength(1);
    // One conditional publication attempt (which lost), then a reparse of the winner.
    expect(world.writes).toEqual([["Dense", DOC]]);
    expect(world.doc.selected_sheet).toBe("Sparse");
    expect(world.downloads).toBe(2);
  });

  it("with no competitor, the preview publishes its own choice before returning, and the rows are that sheet's", async () => {
    install(sparseDenseBuffer(), { selected_sheet: null, source_filename: "sparse-dense.xlsx" });
    const r = await preview();
    if (!("kind" in r) || r.kind !== "table") throw new Error("expected a table: " + JSON.stringify(r));
    expect(r.table.sheetName).toBe("Dense");
    expect(r.table.rows).toHaveLength(10);
    expect(world.writes).toEqual([["Dense", DOC]]);
    expect(world.doc.selected_sheet).toBe("Dense");
    expect(world.downloads).toBe(1);
  });

  it("an already-persisted selection is used as-is with no write and no reparse", async () => {
    install(sparseDenseBuffer(), { selected_sheet: "Sparse", source_filename: "sparse-dense.xlsx" });
    const r = await preview();
    if (!("kind" in r) || r.kind !== "table") throw new Error("expected a table: " + JSON.stringify(r));
    expect(r.table.sheetName).toBe("Sparse");
    expect(r.table.rows).toHaveLength(1);
    expect(world.writes).toEqual([]);
    expect(world.downloads).toBe(1);
  });

  it("a persistence failure returns a recovery error and never the unconfirmed table", async () => {
    install(sparseDenseBuffer(), { selected_sheet: null, source_filename: "sparse-dense.xlsx" });
    world.failUpdate = new Error("permission denied for table documents");
    const r = await preview();
    expect("kind" in r).toBe(false);
    expect("table" in r).toBe(false);
    if (!("error" in r)) throw new Error("expected an error");
    expect(r.error).toMatch(/Could not confirm which sheet of "sparse-dense\.xlsx" holds its data/);
    expect(r.error).toMatch(/Try again/);
    expect(r.error).toMatch(/permission denied for table documents/);
    expect(world.doc.selected_sheet).toBeNull();
  });

  it("a persisted sheet that no longer exists keeps its explicit recovery error, with no write and no substitution", async () => {
    install(sparseDenseBuffer(), { selected_sheet: "Removed", source_filename: "sparse-dense.xlsx" });
    const r = await preview();
    expect("table" in r).toBe(false);
    if (!("error" in r)) throw new Error("expected an error");
    expect(r.error).toMatch(/"Removed" no longer exists in the workbook/);
    expect(world.writes).toEqual([]);
  });

  it("a winner naming a sheet this workbook does not contain is refused, not replaced by the preview's own pick", async () => {
    install(sparseDenseBuffer(), { selected_sheet: null, source_filename: "sparse-dense.xlsx" });
    world.afterDocumentRead = () => {
      world.doc.selected_sheet = "Gone";
    };
    const r = await preview();
    expect("table" in r).toBe(false);
    if (!("error" in r)) throw new Error("expected an error");
    expect(r.error).toMatch(/"Gone" no longer exists in the workbook/);
  });

  it("CSV keeps the existing synthetic Sheet1 provenance (P2a G7 passing behaviour), with leading-zero ids intact", async () => {
    install(csvBuffer(), { selected_sheet: null, source_filename: "cases.csv" });
    const r = await preview();
    if (!("kind" in r) || r.kind !== "table") throw new Error("expected a table: " + JSON.stringify(r));
    expect(r.table.sheetName).toBe("Sheet1");
    expect(world.writes).toEqual([["Sheet1", DOC]]);
    expect(r.table.rows[0].RespondentID).toBe("001");
  });
});
