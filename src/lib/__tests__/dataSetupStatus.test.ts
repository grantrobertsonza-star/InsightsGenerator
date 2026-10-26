// Permanent regression tests for the overnight queue's package 4 (IMP-014) fix to
// loadDataSetup/saveDataSetup's callers: surfacing a genuine lookup failure instead of
// silently returning indistinguishable defaults, and exercising the actual compare-and-swap
// path saveDataSetup already implements. These call the real loadDataSetupWithStatus and
// saveDataSetup entry points, not reimplementations of their logic.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({
  withTenant: vi.fn(),
  withTenantRead: vi.fn(),
}));

import { loadDataSetupWithStatus, saveDataSetup } from "../dataSetup";
import { withTenant, withTenantRead } from "../db";
import { DEFAULT_DATA_SETUP, type DataSetup } from "../dataSetupShared";

describe("loadDataSetupWithStatus (overnight queue, package 4, IMP-014)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a genuine lookup failure (e.g. missing migration) is reported as ok:false with the real error, not masked as defaults", async () => {
    vi.mocked(withTenantRead).mockRejectedValue(new Error('column "data_setup" does not exist'));
    const r = await loadDataSetupWithStatus("tenant-1", "doc-1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/data_setup/);
    // Still returns usable defaults so a caller that only wants the value (loadDataSetup,
    // used by every calculation path) keeps working exactly as before this fix.
    expect(r.setup).toEqual(DEFAULT_DATA_SETUP);
  });

  it("a document with nothing saved yet is ok:true with defaults - distinct from a failure", async () => {
    vi.mocked(withTenantRead).mockImplementation(async (_tenantId, cb) =>
      cb({ query: async () => ({ rows: [{ data_setup: null }] }) } as never),
    );
    const r = await loadDataSetupWithStatus("tenant-1", "doc-1");
    expect(r.ok).toBe(true);
    expect(r.setup).toEqual(DEFAULT_DATA_SETUP);
  });

  it("a document with a saved design is read back intact", async () => {
    const saved = { ...DEFAULT_DATA_SETUP, design: { mode: "explicit", psu: "PSU", strata: "STRATA" } };
    vi.mocked(withTenantRead).mockImplementation(async (_tenantId, cb) =>
      cb({ query: async () => ({ rows: [{ data_setup: saved }] }) } as never),
    );
    const r = await loadDataSetupWithStatus("tenant-1", "doc-1");
    expect(r.ok).toBe(true);
    expect(r.setup.design).toEqual({ mode: "explicit", psu: "PSU", strata: "STRATA" });
  });
});

describe("saveDataSetup compare-and-swap (overnight queue, package 4, IMP-014)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function fakeDb(initial: unknown) {
    let current = initial;
    const calls: { sql: string; params: unknown[] }[] = [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        const s = sql.toLowerCase();
        if (s.includes("select data_setup from documents where id") && s.includes("for update")) {
          return { rows: current === undefined ? [] : [{ data_setup: current }], rowCount: current === undefined ? 0 : 1 };
        }
        if (s.includes("update documents set data_setup")) {
          current = JSON.parse(params[0] as string);
          return { rowCount: 1 };
        }
        throw new Error("unhandled mock query: " + sql);
      },
    };
    vi.mocked(withTenant).mockImplementation(async (_tenantId, cb) => cb(client as never));
    return { calls, get current() { return current; } };
  }

  it("a save whose `expected` no longer matches what's persisted is rejected as a conflict, not applied", async () => {
    const original: DataSetup = { ...DEFAULT_DATA_SETUP, design: { mode: "explicit", psu: "A", strata: null } };
    // Someone else already changed it since `original` was last read.
    const actuallyPersisted: DataSetup = { ...DEFAULT_DATA_SETUP, design: { mode: "explicit", psu: "B", strata: null } };
    const db = fakeDb(actuallyPersisted);

    const attempted: DataSetup = { ...DEFAULT_DATA_SETUP, design: { mode: "explicit", psu: "C", strata: null } };
    const r = await saveDataSetup("tenant-1", "run-1", "doc-1", attempted, { kind: "value", setup: original });

    expect(r.saved).toBe(false);
    if (!r.saved) expect(r.current?.design).toEqual({ mode: "explicit", psu: "B", strata: null });
    // The attempted write must NOT have reached the database - this is what "a newer workspace
    // save caller omits compare-and-swap ... can retain an older configuration after reordered
    // saves" describes: an unconditional overwrite would have clobbered "B" with "C" here.
    expect(db.current).toBe(actuallyPersisted);
  });

  it("a save whose `expected` DOES match what's persisted succeeds and the new value is what's stored", async () => {
    const original: DataSetup = { ...DEFAULT_DATA_SETUP, design: { mode: "explicit", psu: "A", strata: null } };
    const db = fakeDb(original);

    const next: DataSetup = { ...DEFAULT_DATA_SETUP, design: { mode: "explicit", psu: "C", strata: null } };
    const r = await saveDataSetup("tenant-1", "run-1", "doc-1", next, { kind: "value", setup: original });

    expect(r.saved).toBe(true);
    expect((db.current as DataSetup).design).toEqual({ mode: "explicit", psu: "C", strata: null });
  });

  it("expected kind 'none' is rejected if something has already been saved for this document", async () => {
    const actuallyPersisted: DataSetup = { ...DEFAULT_DATA_SETUP, design: { mode: "none", psu: null, strata: null } };
    fakeDb(actuallyPersisted);

    const attempted: DataSetup = { ...DEFAULT_DATA_SETUP, design: { mode: "explicit", psu: "X", strata: null } };
    const r = await saveDataSetup("tenant-1", "run-1", "doc-1", attempted, { kind: "none" });

    expect(r.saved).toBe(false);
    if (!r.saved) expect(r.current?.design).toEqual({ mode: "none", psu: null, strata: null });
  });
});
