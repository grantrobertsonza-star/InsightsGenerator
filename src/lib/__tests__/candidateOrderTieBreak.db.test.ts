// Deep golden-thread check observation (2026-10-17): accepted objectives and decisions were
// ordered by created_at only, so two saved in the same instant had no defined order and their
// numbering in runs.decision_statement / runs.research_objective could change between syncs.
// Every place that reads the accepted list now breaks a created_at tie by id: runSync.ts (the
// statements), objectiveValidator.ts and objectiveEvidence.ts (readCurrentEvidenceItems and the
// evidence loader). The lists still differ in one deliberate way: the research objective statement
// puts researcher-written objectives before AI-suggested ones, while the evidence loaders order by
// time only. So the statement's numbering and the evidence items' order agree here only because
// both fixtures share one source; this test checks the tie-break, not universal list agreement.
// Real disposable PostgreSQL. The rows with the larger id are inserted first, so the physical
// (heap) order a tie used to fall back to is the opposite of the id order now required.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { syncDecisionStatement, syncResearchObjective } from "../runSync";
import { readCurrentEvidenceItems } from "../objectiveEvidence";

// objectiveEvidence.ts imports the storage client at load time; no storage call is made here.
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));

const LOW = "00000000-0000-4000-8000-000000000001";
const HIGH = "ffffffff-ffff-4fff-bfff-ffffffffffff";

describe.skipIf(!TEST_DATABASE_URL)("accepted objectives and decisions saved in the same instant keep a fixed order (real database)", () => {
  let db: DisposableDb;
  const tenant = randomUUID();
  let run: string;
  beforeAll(async () => {
    db = await createDisposableDb();
    await db.pool.query("insert into tenants(id,name) values($1,'Synthetic order')", [tenant]);
    run = (await db.pool.query("insert into runs(tenant_id,project_name) values($1,'Order') returning id", [tenant])).rows[0].id;
    for (const [table, low, high] of [["decision_candidates", "Decision low id", "Decision high id"], ["objective_candidates", "Objective low id", "Objective high id"]] as const) {
      // Same timestamp, same source; larger id inserted first.
      await db.pool.query(
        `insert into ${table}(id,tenant_id,run_id,candidate_text,rationale,source,status,created_at) values
           ($1,$3,$4,$5,'r','researcher_authored','accepted','2026-10-17 10:00:00+00'),
           ($2,$3,$4,$6,'r','researcher_authored','accepted','2026-10-17 10:00:00+00')`,
        [HIGH, LOW, tenant, run, high, low],
      );
    }
  }, 120000);
  afterAll(async () => { await db?.drop(); });

  it("numbers the statements by id within a tie, the same on every sync", async () => {
    const client = await db.pool.connect();
    try {
      for (let i = 0; i < 3; i++) {
        await syncDecisionStatement(client, run);
        await syncResearchObjective(client, run);
        const r = (await client.query("select decision_statement, research_objective from runs where id=$1", [run])).rows[0];
        expect(r.decision_statement).toBe("1. Decision low id\n2. Decision high id");
        expect(r.research_objective).toBe("1. Objective low id\n2. Objective high id");
      }
    } finally {
      client.release();
    }
  });

  it("the evidence items break the same tie by id (same source, so the order matches the statements here)", async () => {
    const client = await db.pool.connect();
    try {
      const items = await readCurrentEvidenceItems(client, run);
      expect(items.map((x) => [x.kind, x.order, x.candidateId])).toEqual([
        ["objective", 0, LOW], ["objective", 1, HIGH], ["decision", 0, LOW], ["decision", 1, HIGH],
      ]);
    } finally {
      client.release();
    }
  });
});
describe.skipIf(!!TEST_DATABASE_URL)("accepted objectives and decisions saved in the same instant keep a fixed order (real database)", () => { it.skip(DISPOSABLE_DB_SKIP_REASON, () => {}); });
