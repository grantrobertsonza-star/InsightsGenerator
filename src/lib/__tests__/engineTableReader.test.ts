// The stored-preview check (importPreviewIdentity.ts) shows a table without a fresh read only when its
// read_provenance names the engine reader that produced it. That name is written by the engine
// (TABLE_READER in api/parse-stats-file.py) and compared in TypeScript (ENGINE_TABLE_READER); if they
// drift, every stored table is re-read on each view (slow but safe), so this keeps them equal.
import { describe, expect, it, vi } from "vitest";
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../db", () => ({ withTenantRead: vi.fn() }));
import { readFileSync } from "node:fs";
import path from "node:path";
import { ENGINE_STATS_READER, ENGINE_TABLE_READER } from "../importPreviewIdentity";

describe("engine table reader name", () => {
  it("TypeScript names the reader the engine writes", () => {
    const engine = readFileSync(path.join(process.cwd(), "api", "parse-stats-file.py"), "utf8");
    const m = engine.match(/^TABLE_READER = "([^"]+)"$/m);
    expect(m?.[1]).toBe(ENGINE_TABLE_READER);
    expect(engine.match(/^STATS_READER = "([^"]+)"$/m)?.[1]).toBe(ENGINE_STATS_READER);
  });
});
