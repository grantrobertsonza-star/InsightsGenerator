import { describe, it, expect, vi } from "vitest";
import type { PoolClient } from "pg";
import { archiveAndReplaceFindings } from "../findingArchive";

// Regression coverage for the silent-rollback bug this project hit: two
// insight-generation passes racing on the same run could leave two insight
// rows pointing at the same finding_id, and because insight_history.
// original_finding_id is unique, archiving one of those findings threw a
// unique violation that rolled back the ENTIRE archive-and-replace
// transaction -- the delete, the fresh extraction, everything for that
// document -- with nothing surfaced to the researcher. The fix was the
// `distinct on (i.finding_id)` dedup picks below, plus `on conflict do
// nothing` as a second line of defense. None of that is visible from the
// outside (it only matters once a run actually has duplicate insights),
// so these tests check the SQL this function issues rather than its
// return value: if a future edit drops the dedup CTE, the "on conflict"
// clause, or reorders the delete ahead of the snapshot, one of these
// assertions should catch it before it reaches production as the same
// silent failure again.
function createMockClient() {
  const calls: { text: string; params: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      calls.push({ text, params });
      return { rows: [] };
    }),
  } as unknown as PoolClient;
  return { client, calls };
}

describe("archiveAndReplaceFindings", () => {
  it("issues the four archive inserts before deleting, in order, and never deletes early", async () => {
    const { client, calls } = createMockClient();

    await archiveAndReplaceFindings(client, {
      documentColumn: "source_table_id",
      documentId: "doc-1",
      onlyRejected: false,
      archiveReason: "full_reprocess",
    });

    expect(calls).toHaveLength(5);
    expect(calls[0].text).toMatch(/insert into finding_history/i);
    expect(calls[1].text).toMatch(/insert into verdict_history/i);
    expect(calls[2].text).toMatch(/insert into insight_history/i);
    expect(calls[3].text).toMatch(/insert into recommendation_history/i);
    // The delete must be last: everything above has to be safely snapshotted
    // (in the same transaction the caller holds) before anything is removed.
    expect(calls[4].text).toMatch(/delete from findings/i);
  });

  it("dedupes insights per finding_id before archiving, so a duplicate can't abort the transaction", async () => {
    const { client, calls } = createMockClient();

    await archiveAndReplaceFindings(client, {
      documentColumn: "source_document_id",
      documentId: "doc-1",
      onlyRejected: false,
      archiveReason: "manual_reextract",
    });

    const insightHistoryInsert = calls[2].text;
    expect(insightHistoryInsert).toMatch(/distinct on \(i\.finding_id\)/i);
    expect(insightHistoryInsert).toMatch(
      /on conflict \(original_finding_id\) do nothing/i,
    );

    // recommendation_history must join against the SAME picked set, not the
    // raw insights table -- otherwise it can reference an insight that lost
    // the pick and was never actually archived above.
    const recommendationHistoryInsert = calls[3].text;
    expect(recommendationHistoryInsert).toMatch(
      /distinct on \(i\.finding_id\)/i,
    );
  });

  it("also guards finding_history with on conflict do nothing", async () => {
    const { client, calls } = createMockClient();

    await archiveAndReplaceFindings(client, {
      documentColumn: "source_table_id",
      documentId: "doc-1",
      onlyRejected: false,
      archiveReason: "regenerate_unreviewed",
    });

    expect(calls[0].text).toMatch(
      /on conflict \(original_finding_id\) do nothing/i,
    );
  });

  it("scopes to rejected findings only when onlyRejected is true", async () => {
    const { client, calls } = createMockClient();

    await archiveAndReplaceFindings(client, {
      documentColumn: "source_table_id",
      documentId: "doc-1",
      onlyRejected: true,
      archiveReason: "regenerate_unreviewed",
    });

    expect(calls[0].text).toMatch(/and status = 'rejected'/i);
    expect(calls[1].text).toMatch(/and f\.status = 'rejected'/i);
    expect(calls[2].text).toMatch(/and f\.status = 'rejected'/i);
    expect(calls[3].text).toMatch(/and f\.status = 'rejected'/i);
    expect(calls[4].text).toMatch(/and status = 'rejected'/i);
  });

  it("does not scope to rejected when onlyRejected is false (full reprocess touches everything)", async () => {
    const { client, calls } = createMockClient();

    await archiveAndReplaceFindings(client, {
      documentColumn: "source_table_id",
      documentId: "doc-1",
      onlyRejected: false,
      archiveReason: "full_reprocess",
    });

    for (const call of calls) {
      expect(call.text).not.toMatch(/status = 'rejected'/i);
    }
  });
});
