import { withTenant, withTenantRead } from "./db";
import { isPlainTableFileName, normaliseDataSetup, DEFAULT_DATA_SETUP, type DataSetup } from "./dataSetupShared";
import { cellValue, setCell, type TableCell } from "./rowCells";

type Cell = TableCell;

/**
 * Unique variable names for a list of literal names, by the engine's rule (_dedupe_header_names in
 * api/parse-stats-file.py, TP500-F02): every literal name is reserved first, the first occurrence keeps
 * it, and each later repeat takes the next "name (n)" that no literal name or earlier allocation holds.
 * So "q", "q", "q (2)" become "q", "q (3)", "q (2)": the row literally named "q (2)" keeps its name and
 * values, and nothing is overwritten. Must stay statement-for-statement with the engine's function.
 */
export function allocateVariableNames(names: string[]): string[] {
  if (new Set(names).size === names.length) return [...names];
  const used = new Set(names);
  const counts = new Map<string, number>();
  return names.map((name) => {
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    if (count === 1) return name;
    let n = count;
    let candidate = `${name} (${n})`;
    while (used.has(candidate)) {
      n += 1;
      candidate = `${name} (${n})`;
    }
    counts.set(name, n);
    used.add(candidate);
    return candidate;
  });
}

/**
 * Flips a table whose rows are variables and columns are cases. Used only for a table found in a
 * document's text (Word, PDF): CSV, TSV and Excel files are flipped by the engine's own reader. A row's
 * name is its first cell's literal text ("Variable n" when blank), allocated by allocateVariableNames.
 */
export function transposeTable(headers: string[], rows: Record<string, Cell>[]) {
  if (headers.length < 2) return { headers, rows };
  const key = headers[0];
  const names = allocateVariableNames(rows.map((r, i) => String(cellValue(r, key) ?? "").trim() || `Variable ${i + 1}`));
  const out = headers.slice(1).map((h) => {
    const o: Record<string, Cell> = {};
    rows.forEach((r, i) => {
      setCell(o, names[i], cellValue(r, h) ?? null);
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
  const r = await loadDataSetupWithStatus(tenantId, documentId);
  return r.setup;
}

/**
 * Overnight queue, package 4: `loadDataSetup` above swallows every failure - a missing
 * migration, a dropped connection, a permission error - identically to "this document has
 * never had a set-up saved," so a UI caller that only sees the returned DEFAULT_DATA_SETUP
 * cannot tell a genuinely-new document from one whose real saved choice it just failed to
 * read. Most callers (the calculation paths: buildCrosstab, the NPS tool, Objectives, the
 * distribution chart, etc.) are deliberately kept tolerant of this - defaulting and carrying
 * on is the right behavior for a background computation - so `loadDataSetup` itself keeps
 * swallowing for them, unchanged. This variant exists for a caller that can and should
 * surface the distinction to a person, such as the Cross tabs workspace's own load.
 */
export async function loadDataSetupWithStatus(
  tenantId: string,
  documentId: string,
): Promise<{ setup: DataSetup; ok: true } | { setup: DataSetup; ok: false; error: string }> {
  try {
    const setup = await withTenantRead(tenantId, async (client) => {
      const r = await client.query<{ data_setup: unknown }>("select data_setup from documents where id = $1", [documentId]);
      return normaliseDataSetup(r.rows[0]?.data_setup);
    });
    return { setup, ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { setup: DEFAULT_DATA_SETUP, ok: false, error: message };
  }
}

/**
 * What a caller last saw for this document's data set-up, so a save can guard against
 * clobbering a different change that landed in between: "none" when the caller believes
 * nothing has been saved yet (the column is still null), or the exact value it last read.
 * Optional, and back-compatible: a caller that passes nothing gets the old unconditional
 * overwrite, same as before this guard existed.
 */
export type ExpectedPreviousSetup = { kind: "none" } | { kind: "value"; setup: DataSetup };

/**
 * Two saves of the same document's set-up can be in flight at once - most often the
 * "accept with defaults on first view" effect racing a researcher's own deliberate edit,
 * both firing close together on load - and a slow network can let the OLDER request's
 * response land after the newer one's, silently overwriting the newer choice with the
 * older, now-stale one. Passing `expected` turns this into a compare-and-swap: the write
 * only applies if the column still holds what the caller last saw, and the caller is told
 * what it actually holds otherwise, instead of winning a race it didn't know it was in.
 */
export async function saveDataSetup(
  tenantId: string,
  runId: string,
  documentId: string,
  setup: DataSetup,
  expected?: ExpectedPreviousSetup,
): Promise<{ saved: true } | { saved: false; current: DataSetup | null; notFound?: boolean; refused?: string }> {
  return withTenant(tenantId, async (client) => {
    // A header row choice (decision 9) only applies to a CSV, TSV, text or Excel file; every reader refuses it for any
    // other format, so it is refused here rather than saved where nothing could read the file. Read in this
    // transaction, scoped to the run, before the write below.
    if (normaliseDataSetup(setup).headerRowsSkipped !== null) {
      const f = await client.query<{ source_filename: string }>(
        "select source_filename from documents where id = $1 and run_id = $2",
        [documentId, runId],
      );
      if (f.rowCount === 0) return { saved: false, current: null, notFound: true };
      if (!isPlainTableFileName(f.rows[0].source_filename)) {
        return {
          saved: false,
          current: null,
          refused: "Only CSV, TSV, text and Excel files have a header row to choose; this file names its variables itself.",
        };
      }
    }
    if (expected) {
      const r = await client.query<{ data_setup: unknown }>(
        "select data_setup from documents where id = $1 and run_id = $2 for update",
        [documentId, runId],
      );
      // No row at all (the document was deleted, or never belonged to this run) used to read
      // as `raw === null`, the exact same shape an existing document with no setup yet saved
      // produces - so expecting "none" against a document that no longer exists "matched" by
      // coincidence and fell through to the no-op update below, which this same gap let return
      // `{ saved: true }` for a target row count of zero either way.
      if (r.rowCount === 0) {
        return { saved: false, current: null, notFound: true };
      }
      const raw = r.rows[0].data_setup ?? null;
      const matches =
        expected.kind === "none"
          ? raw === null
          : JSON.stringify(normaliseDataSetup(raw)) === JSON.stringify(normaliseDataSetup(expected.setup));
      if (!matches) {
        return { saved: false, current: raw === null ? null : normaliseDataSetup(raw) };
      }
    }
    const result = await client.query("update documents set data_setup = $1 where id = $2 and run_id = $3", [
      JSON.stringify(normaliseDataSetup(setup)),
      documentId,
      runId,
    ]);
    // Without `expected`, this is the only check that the target document actually exists in
    // this run - an id typo'd, deleted mid-edit, or from a stale page otherwise updated zero
    // rows and still reported success, leaving the researcher's selection shown as saved when
    // nothing was.
    if (result.rowCount === 0) {
      return { saved: false, current: null, notFound: true };
    }
    return { saved: true };
  });
}
