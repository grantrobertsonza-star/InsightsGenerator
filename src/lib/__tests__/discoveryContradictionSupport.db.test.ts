// FND-001 support policy for contradictions backed directly by a FINDING, on a real disposable
// database through the actual loadDiscoveryReportData + applySupportToDiscovery (the reads and rule
// both story exports use). One report claim, four contradicting computed findings:
//   - accepted, untouched since the contradiction was found          -> shown, no note
//   - rejected by the researcher                                      -> left out and disclosed
//   - wording edited after the contradiction was found (provenance)   -> shown, "changed" note
//   - only its theme edited after                                     -> shown, no note (wording
//                                                                        unchanged)
// and a contradicting finding deleted outright removes its contradiction (on delete cascade), so
// nothing can be listed against a finding that no longer exists.
// Skipped, with a printed reason, when TEST_DATABASE_URL is not set.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDisposableDb, DISPOSABLE_DB_SKIP_REASON, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { applySupportToDiscovery, loadDiscoveryReportData } from "../discoveryReport";
import { uncheckedSupport } from "../supportStatusShared";

describe.skipIf(!TEST_DATABASE_URL)("contradictions backed by findings follow the support policy (real database)", () => {
  let db: DisposableDb;
  let tenant = "";
  let run = "";
  const one = async (sql: string, params: unknown[]) => (await db.pool.query(sql, params)).rows[0].id as string;
  const finding = (origin: string, text: string, status = "accepted") =>
    one(`insert into findings (tenant_id, run_id, origin, finding_text, status) values ($1, $2, $3, $4, $5) returning id`, [tenant, run, origin, text, status]);

  beforeAll(async () => {
    db = await createDisposableDb();
    tenant = await one(`insert into tenants (name) values ('T') returning id`, []);
    run = await one(`insert into runs (tenant_id) values ($1) returning id`, [tenant]);
  }, 120000);
  afterAll(async () => {
    await db?.drop();
  });

  it("rejected: left out and disclosed; wording edited since: qualified; theme-only edit: current; deleted: gone", async () => {
    const claim = await finding("stated", "Region A grew fastest");
    const untouched = await finding("generated", "Region B grew 9 points");
    const rejected = await finding("generated", "Region C grew 7 points", "rejected");
    const reworded = await finding("generated", "Region D grew 5 points");
    const themed = await finding("generated", "Region E grew 3 points");
    const deleted = await finding("generated", "Region F grew 2 points");
    for (const f of [untouched, rejected, reworded, themed, deleted]) {
      await db.pool.query(
        `insert into finding_contradictions (tenant_id, run_id, original_finding_id, contradicting_finding_id, rationale, detected_by, created_at)
         values ($1, $2, $3, $4, 'The table disagrees.', 'chain_trace', now() - interval '1 day')`,
        [tenant, run, claim, f],
      );
    }
    // Researcher edits recorded after the contradictions were found (0094 provenance columns).
    await db.pool.query(`update findings set finding_text = 'Region D grew 6 points', human_edited_at = now(), human_edited_fields = '{finding_text}' where id = $1`, [reworded]);
    await db.pool.query(`update findings set theme = 'Regions', human_edited_at = now(), human_edited_fields = '{theme}' where id = $1`, [themed]);
    await db.pool.query(`delete from findings where id = $1`, [deleted]);

    const client = await db.pool.connect();
    let data;
    try {
      data = await loadDiscoveryReportData(client, run);
    } finally {
      client.release();
    }
    // Finding-backed contradictions do not consult insight support at all.
    const { discovery, excluded } = applySupportToDiscovery(data, () => uncheckedSupport("not used"));
    const shown = discovery.contradictions.map((c) => [c.contradictingText, c.supportNote ?? null]);
    expect(shown).toEqual(
      expect.arrayContaining([
        ["Region B grew 9 points", null],
        ["Region D grew 6 points", "Support changed since drafted: the contradicting finding's wording was edited after this contradiction was found"],
        ["Region E grew 3 points", null],
      ]),
    );
    expect(shown).toHaveLength(3);
    expect(excluded).toEqual([
      {
        kind: "contradiction",
        insightId: null,
        headline: "“Region A grew fastest”, contradicted by “Region C grew 7 points”",
        reason: "the contradicting finding was rejected",
      },
    ]);
    expect(JSON.stringify(discovery)).not.toContain("Region F");
  });
});

describe.skipIf(!!TEST_DATABASE_URL)("contradictions backed by findings follow the support policy (real database)", () => {
  it.skip(DISPOSABLE_DB_SKIP_REASON, () => {});
});
