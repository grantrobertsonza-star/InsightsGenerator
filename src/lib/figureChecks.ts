import type { PoolClient } from "pg";
import type { FigureCheck } from "./numberTrace";

/**
 * Storage side of the numerical traceability check (migration 0101). The check itself is
 * numberTrace.ts; this module only answers whether the column exists and loads what was stored,
 * so every generator, screen and export reads it the same way.
 */

const TABLES = ["insights", "synthesized_insights", "recommendations", "deck_narratives"];
let confirmed = false;

/** Whether 0101 is applied on all four tables (a positive answer is cached; a negative never is). */
export async function figureCheckAvailable(client: PoolClient): Promise<boolean> {
  if (confirmed) return true;
  const r = await client.query<{ n: number }>(
    `select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and column_name = 'figure_check' and table_name = any($1::text[])`,
    [TABLES],
  );
  confirmed = r.rows[0]?.n === TABLES.length;
  return confirmed;
}

/** SQL for selecting a row's stored check: the column when 0101 is applied, otherwise null. */
export function figureCheckSql(available: boolean, alias: string): string {
  return available ? `${alias}.figure_check` : "null::jsonb";
}

export type RunFigureChecks = {
  available: boolean;
  preInsights: Record<string, FigureCheck>;
  synthesizedInsights: Record<string, FigureCheck>;
  recommendations: Record<string, FigureCheck>;
  narrative: FigureCheck | null;
  /** Set when the read failed: shown as such, never read as "nothing to review". */
  error?: string;
};

/** Every stored check in a run that is not "traced" (traced and unchecked rows are omitted). */
export async function loadRunFigureChecks(client: PoolClient, runId: string): Promise<RunFigureChecks> {
  const empty = { preInsights: {}, synthesizedInsights: {}, recommendations: {}, narrative: null };
  if (!(await figureCheckAvailable(client))) return { available: false, ...empty };
  const flagged = async (table: string) => {
    const r = await client.query<{ id: string; figure_check: FigureCheck }>(
      `select id, figure_check from ${table}
        where run_id = $1 and figure_check is not null and figure_check->>'status' <> 'traced'`,
      [runId],
    );
    return Object.fromEntries(r.rows.map((row) => [row.id, row.figure_check]));
  };
  const narrative = await client.query<{ figure_check: FigureCheck | null }>(
    "select figure_check from deck_narratives where run_id = $1",
    [runId],
  );
  return {
    available: true,
    preInsights: await flagged("insights"),
    synthesizedInsights: await flagged("synthesized_insights"),
    recommendations: await flagged("recommendations"),
    narrative: narrative.rows[0]?.figure_check ?? null,
  };
}

/**
 * For exports: the run's stored checks, or an explicit error. Never throws, so a failed read
 * qualifies the export ("figures not checked") instead of blocking it or reading as clean.
 */
export async function loadRunFigureChecksForExport(
  withClient: <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>,
  runId: string,
): Promise<RunFigureChecks> {
  try {
    return await withClient((client) => loadRunFigureChecks(client, runId));
  } catch (error) {
    return {
      available: false,
      preInsights: {},
      synthesizedInsights: {},
      recommendations: {},
      narrative: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The export line for a failed read, or null. */
export function figureCheckLoadErrorNote(checks: RunFigureChecks): string | null {
  return checks.error
    ? `Whether the figures in AI-written text trace to their evidence could not be checked for this export (${checks.error}); treat them as not checked.`
    : null;
}

/** Joins qualification lines, dropping empty ones; undefined when nothing remains. */
export function joinNotes(...notes: (string | null | undefined)[]): string | undefined {
  const kept = notes.filter((n): n is string => !!n && n.trim() !== "");
  return kept.length > 0 ? kept.join(" ") : undefined;
}
