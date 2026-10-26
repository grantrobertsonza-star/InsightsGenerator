import { withTenantRead } from "./db";

// Whether the last methodology reading finished (Codex RR-F02, 2026-10-23). The processing step
// records methodology_extraction_error when methodologyExtractor throws, and the extractor records
// methodology_extraction_done when a reading finishes (with or without a methodology); the later
// of the two decides. Read by the Insights report section and the Word report export.

/**
 * Whether the latest methodology reading failed, with its message and whether a methodology read
 * earlier is still saved; null when the latest reading finished or none has run. The page shows it,
 * and the Word report says the methodology could not be read rather than that none was stated
 * (RR-F02).
 */
export async function latestMethodologyFailure(tenantId: string, runId: string): Promise<{ message: string; savedEarlier: boolean } | null> {
  return withTenantRead(tenantId, async (client) => {
    const r = await client.query<{ event: string; detail: { message?: unknown } | null; saved: boolean }>(
      `select t.event, t.detail, (select r.methodology is not null from runs r where r.id = $1) as saved
         from trace t
        where t.run_id = $1 and t.event in ('methodology_extraction_error', 'methodology_extraction_done')
        order by t.occurred_at desc, t.id desc limit 1`,
      [runId],
    );
    const row = r.rows[0];
    if (!row || row.event !== "methodology_extraction_error") return null;
    return {
      message: typeof row.detail?.message === "string" ? row.detail.message : "The reading of the methodology failed.",
      savedEarlier: row.saved === true,
    };
  });
}
