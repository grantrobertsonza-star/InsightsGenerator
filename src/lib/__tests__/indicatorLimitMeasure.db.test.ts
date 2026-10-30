// Measurement, not a regression check (batch 54): the save path of indicator data (reading the engine's
// answer, validateIndicatorResult, publishIndicatorRead into a real disposable PostgreSQL) on the answers
// written by scripts/measure_indicator_limits.py, to set the values limit against the deployed 2,048 MB
// and 60 s. Runs only when INDICATOR_MEASURE_DIR names that output folder; prints time and the Node
// process's resident memory (sampled every 20 ms) for each answer. Results: claude/indicator-data.md.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";

vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.setConfig({ testTimeout: 600_000, hookTimeout: 180_000 });
const DIR = process.env.INDICATOR_MEASURE_DIR ?? "";

describe.skipIf(!TEST_DATABASE_URL || !DIR)("indicator data save path measurement (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run = "";
  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await db.pool.query("insert into tenants (id, name) values ($1, 'T')", [tenant]);
    run = (await db.pool.query("insert into runs (tenant_id, project_name) values ($1, 'Measure') returning id", [tenant])).rows[0].id;
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  it("measures each answer", async () => {
    const { validateIndicatorResult, publishIndicatorRead } = await import("../indicatorData");
    const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort((a, b) => readFileSync(path.join(DIR, a)).length - readFileSync(path.join(DIR, b)).length);
    for (const f of files) {
      global.gc?.();
      const doc = (await db.pool.query("insert into documents (tenant_id, run_id, kind, source_filename, storage_path) values ($1, $2, 'indicator', $3, $4) returning id", [tenant, run, f, `${tenant}/${run}/${f}`])).rows[0].id;
      const base = process.memoryUsage().rss;
      let peak = base;
      const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 20);
      const t0 = performance.now();
      const text = readFileSync(path.join(DIR, f), "utf8");
      const result = validateIndicatorResult(JSON.parse(text));
      const t1 = performance.now();
      const published = await publishIndicatorRead(tenant, run, doc, result);
      const t2 = performance.now();
      clearInterval(timer);
      expect(published.observations).toBe(result.observations.length);
      console.log(
        `MEASURED save ${f}: ${published.observations} values, answer ${(text.length / 1e6).toFixed(1)} MB; parse and check ${((t1 - t0) / 1000).toFixed(1)} s, write ${((t2 - t1) / 1000).toFixed(1)} s; Node rss ${(base / 1e6).toFixed(0)} MB before, peak ${(peak / 1e6).toFixed(0)} MB (+${((peak - base) / 1e6).toFixed(0)} MB)`,
      );
      // Free the rows before the next, larger answer.
      await db.pool.query("delete from documents where id = $1", [doc]);
    }
  });
});
