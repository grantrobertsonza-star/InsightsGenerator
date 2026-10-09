import { withTenant, withTenantRead } from "./db";
import { normaliseDataSetup, DEFAULT_DATA_SETUP, type DataSetup } from "./dataSetupShared";

type Cell = string | number | null;

/** Flips a table whose rows are variables and columns are cases. */
export function transposeTable(headers: string[], rows: Record<string, Cell>[]) {
  if (headers.length < 2) return { headers, rows };
  const key = headers[0];
  const seen = new Map<string, number>();
  const names = rows.map((r, i) => {
    const base = String(r[key] ?? "").trim() || `Variable ${i + 1}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base} (${n + 1})`;
  });
  const out = headers.slice(1).map((h) => {
    const o: Record<string, Cell> = {};
    rows.forEach((r, i) => {
      o[names[i]] = r[h] ?? null;
    });
    return o;
  });
  return { headers: names, rows: out };
}

/**
 * Tolerant of the column not existing yet (migration 0057 not applied):
 * returns an empty map, so the page still loads and defaults apply.
 */
export async function loadDataSetups(tenantId: string, runId: string): Promise<Map<string, DataSetup>> {
  try {
    return await withTenantRead(tenantId, async (client) => {
      const r = await client.query<{ id: string; data_setup: unknown }>(
        "select id, data_setup from documents where run_id = $1 and data_setup is not null",
        [runId],
      );
      return new Map(r.rows.map((row) => [row.id, normaliseDataSetup(row.data_setup)] as const));
    });
  } catch {
    return new Map();
  }
}

export async function loadDataSetup(tenantId: string, documentId: string): Promise<DataSetup> {
  try {
    return await withTenantRead(tenantId, async (client) => {
      const r = await client.query<{ data_setup: unknown }>("select data_setup from documents where id = $1", [documentId]);
      return normaliseDataSetup(r.rows[0]?.data_setup);
    });
  } catch {
    return DEFAULT_DATA_SETUP;
  }
}

export async function saveDataSetup(tenantId: string, runId: string, documentId: string, setup: DataSetup) {
  await withTenant(tenantId, async (client) => {
    await client.query("update documents set data_setup = $1 where id = $2 and run_id = $3", [
      JSON.stringify(normaliseDataSetup(setup)),
      documentId,
      runId,
    ]);
  });
}
