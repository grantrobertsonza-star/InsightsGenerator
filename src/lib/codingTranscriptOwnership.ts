import type { PoolClient } from "pg";

/**
 * Confirms that a transcript is this run's and this tenant's and locks its document row for the rest of
 * the transaction; throws, before anything is written, when it is not (Codex COD500-F01, COD500-F02).
 * Row-level security alone does not establish this for writes: an insert is accepted for the caller's
 * own tenant whatever document id it names, and a foreign key checks only that the document exists.
 *
 * - "share" for annotations (theme notes, keywords, turn notes): the document cannot be deleted or moved
 *   to another run before the write commits, while two annotation saves on one transcript still run side
 *   by side.
 * - "update" for coding assignments and codebook versions: these writers serialise on the transcript, so
 *   a turn's change is checked against the codebook version that is actually in force when it is written
 *   (a new version cannot be inserted between that check and the write).
 */
export async function lockOwnedTranscript(
  client: PoolClient,
  tenantId: string,
  runId: string,
  documentId: string,
  mode: "share" | "update",
): Promise<void> {
  const own = await client.query(
    `select id from documents where id = $1 and run_id = $2 and tenant_id = $3 for ${mode === "share" ? "share" : "update"}`,
    [documentId, runId, tenantId],
  );
  if (!own.rows[0]) throw new Error("That transcript is not in this project.");
}
