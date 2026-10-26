// Respondent-level quality checks (Grant, 26 October 2026; respondent_quality in api/parse-stats-file.py,
// loaded by respondentQuality.ts). A designed .sav whose every expected flag is known by construction,
// through the actual loader, the local engine and a real database (storage is an in-memory stand-in):
//   batteries found (and a 0/1 list and unseparated numbered questions not); straightliners per battery
//   and the respondents flagged under the two-battery rule; non-answers where the file labels them;
//   speeders, super-speeders and long interviews against the median; an interviewer whose cases hold
//   every straightliner; the respondents to look at; what could not be measured is said, not zeroed; a
//   columns-as-cases file is checked in its saved layout.
// Skipped, with the reason, without a test database or python3 + pandas/pyreadstat.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

/** 40 respondents designed so every expected flag is known by construction (see the cases below). */
function designedSav(): Buffer {
  const dir = mkdtempSync(path.join(tmpdir(), "respondent-quality-"));
  const out = path.join(dir, "designed.sav");
  const script = String.raw`
import sys, pandas as pd, pyreadstat
n = 40
cols = {"ID": [float(i + 1) for i in range(n)]}
def battery(stem, items, points, straight):
    for j in range(items):
        cols[f"{stem}_{j + 1}"] = [float(3 if i + 1 in straight else ((i + j) % points) + 1) for i in range(n)]
# Cases 1-5 give one answer throughout all three batteries; case 6 only in Q1 (one battery: not
# flagged); case 7 in Q1 and Q2 but not Q3 (two of three: flagged).
battery("Q1", 6, 5, {1, 2, 3, 4, 5, 6, 7})
battery("Q2", 6, 5, {1, 2, 3, 4, 5, 7})
battery("Q3", 5, 4, {1, 2, 3, 4, 5})
# A 0/1 list and numbered questions without a separator: neither is a battery.
for j in range(6):
    cols[f"M_{j + 1}"] = [1.0] * n
for k in range(10, 16):
    cols[f"F{k}"] = [2.0] * n
# Twelve yes/no questions with "Don't know" (99): case 11 answers 99 to 8 of 12 (flagged), case 12 to 5.
for j in range(12):
    cols[f"S{j + 1}"] = [99.0 if (i + 1 == 11 and j < 8) or (i + 1 == 12 and j < 5) else float(1 + (i + j) % 2) for i in range(n)]
# Interview length: median 600; case 8 under half (speeder), case 9 under 30% (super-speeder), case 10
# over three times (long, noted only).
cols["duration"] = [250.0 if i + 1 == 8 else 150.0 if i + 1 == 9 else 2000.0 if i + 1 == 10 else 600.0 for i in range(n)]
# Interviewer B has cases 1-20 (all six straightliners); A has 21-40.
cols["interviewer_id"] = ["B" if i < 20 else "A" for i in range(n)]
labels = {f"S{j + 1}": {1.0: "Yes", 2.0: "No", 99.0: "Don't know"} for j in range(12)}
pyreadstat.write_sav(pd.DataFrame(cols), sys.argv[1], variable_value_labels=labels)
`;
  const r = spawnSync(PYTHON, ["-I", "-c", script, out], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return readFileSync(out);
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("respondent quality checks (real database, actual engine)", () => {
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

  async function file(name: string, bytes: Buffer, setup: unknown = { layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true }) {
    const key = `${tenant}/${run}/${randomUUID()}-${name}`;
    storage.objects.set(key, bytes);
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup)
       values ($1, $2, 'table', 'raw', $3, $4, $5) returning id`,
      [tenant, run, name, key, setup === null ? null : JSON.stringify(setup)],
    ))[0].id as string;
  }
  const check = async (doc: string) => (await import("../respondentQuality")).loadRespondentQuality(tenant, run, doc);

  it("flags the designed respondents and nothing else", async () => {
    const r = await check(await file("designed.sav", designedSav()));
    expect(r.cases).toBe(40);
    expect(r.idVariable).toBe("ID");
    // Batteries: Q1, Q2, Q3 only (not the 0/1 list M, not F10-F15).
    expect(r.straightlining.grids.map((g) => g.stem)).toEqual(["Q1", "Q2", "Q3"]);
    expect(r.straightlining.grids.map((g) => g.straightliners)).toEqual([7, 6, 5]);
    expect(r.straightlining.flagged).toBe(6);
    expect(r.nonAnswer).toMatchObject({ measured: true, variables: 12, flagged: 1 });
    expect(r.duration).toMatchObject({ variable: "duration", median: 600, speeders: 2, superSpeeders: 1, long: 1 });
    const b = r.interviewers.rows.find((x) => x.interviewer === "B")!;
    expect(r.interviewers.variable).toBe("interviewer_id");
    expect(b.straightlinerRate).toBeCloseTo(6 / 20, 6);
    expect(b.check).toContain("more straightlining than other interviewers");
    expect(r.interviewers.rows.find((x) => x.interviewer === "A")!.check).toEqual([]);
    // Distinct respondents flagged: 1-5 and 7 (straightlining), 8 and 9 (speeders), 11 (non-answers).
    expect(r.flaggedCases).toBe(9);
    expect(r.topCases.map((c) => Number(c.id)).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 11]);
    expect(r.topCases.find((c) => c.id === "9")!.reasons.join(" ")).toMatch(/super-speeder: 150 against a median of 600/);
  });

  it("says what it could not measure instead of reporting zero", async () => {
    const r = await check(await file("plain.txt", Buffer.from("ID\tA_1\tA_2\tA_3\tA_4\tA_5\n1\t1\t2\t3\t4\t5\n2\t3\t3\t3\t3\t3\n", "utf-8")));
    expect(r.nonAnswer.measured).toBe(false);
    expect(r.duration.variable).toBeNull();
    expect(r.interviewers.variable).toBeNull();
    expect(r.notes.join(" ")).toMatch(/Non-answers could not be measured.*Speeders could not be checked.*Interviewer differences could not be checked/);
    // One battery answered the same way is not enough to flag a respondent.
    expect(r.straightlining.grids[0].straightliners).toBe(1);
    expect(r.flaggedCases).toBe(0);
  });

  it("reads the file in its saved layout: a columns-as-cases file is checked case by case", async () => {
    // Two respondents in columns; respondent C2 gives 3 to every item of both batteries.
    const lines = ["Variable\tC1\tC2", ...[1, 2, 3, 4, 5].flatMap((j) => [`A_${j}\t${j}\t3`, `B_${j}\t${6 - j}\t3`])];
    const doc = await file("wide.txt", Buffer.from(lines.join("\n") + "\n", "utf-8"), { layout: "columns_are_cases", unit: "respondents", method: "survey", accepted: true });
    const r = await check(doc);
    expect(r.cases).toBe(2);
    expect(r.straightlining.grids.map((g) => [g.stem, g.straightliners])).toEqual([["A", 1], ["B", 1]]);
    expect(r.topCases.map((c) => c.row)).toEqual([2]);
  });
});
