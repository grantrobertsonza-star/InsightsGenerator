import { withTenantRead } from "./db";
import type { OutputKind, OutputRole } from "./outputClassify";
import type { StoredChecks } from "./outputAnalysisRun";

export type OutputFile = {
  id: string;
  name: string;
  path: string;
  family: string;
  role: OutputRole;
  kind: OutputKind;
  confidence: "high" | "medium" | "low";
  signals: string[];
  rows: number;
  cols: number;
  headers: string[];
  sheets: number;
  textLength: number;
};

export type OutputSet = {
  id: string;
  name: string;
  waveLabel: string | null;
  source: "zip" | "files";
  files: OutputFile[];
  /** Results of the last check, if one has run. */
  checks: StoredChecks | null;
};

/** Output sets with their files for a run. Empty until migration 0061 is applied. */
export async function getOutputSets(tenantId: string, runId: string): Promise<OutputSet[]> {
  try {
    return await withTenantRead(tenantId, async (client) => {
      type SetRow = { id: string; name: string; wave_label: string | null; source: "zip" | "files"; checks?: StoredChecks | null };
      let sets: { rows: SetRow[] };
      try {
        sets = await client.query<SetRow>("select id, name, wave_label, source, checks from output_sets where run_id = $1 order by created_at", [runId]);
      } catch {
        // Migration 0062 not applied yet: no stored checks.
        sets = await client.query<SetRow>("select id, name, wave_label, source from output_sets where run_id = $1 order by created_at", [runId]);
      }
      if (sets.rows.length === 0) return [];
      const docs = await client.query<{
        id: string; set_id: string; name: string; path: string | null; family: string | null;
        role: OutputRole | null; kind: OutputKind | null; profile: Record<string, unknown> | null;
      }>(
        `select id, output_set_id as set_id, source_filename as name, output_path as path, output_family as family,
                output_role as role, output_kind as kind, output_profile as profile
         from documents where run_id = $1 and kind = 'output' and output_set_id is not null
         order by output_path`,
        [runId],
      );
      const bySet = new Map<string, OutputFile[]>();
      for (const d of docs.rows) {
        const p = (d.profile ?? {}) as {
          headers?: string[]; rowCount?: number; sheets?: unknown[]; textLength?: number;
          confidence?: "high" | "medium" | "low"; signals?: string[];
        };
        const file: OutputFile = {
          id: d.id,
          name: d.name,
          path: d.path ?? d.name,
          family: d.family ?? "Other files",
          role: d.role ?? "unclassified",
          kind: d.kind ?? "other_table",
          confidence: p.confidence ?? "low",
          signals: p.signals ?? [],
          rows: p.rowCount ?? 0,
          cols: p.headers?.length ?? 0,
          headers: (p.headers ?? []).slice(0, 8),
          sheets: p.sheets?.length ?? 0,
          textLength: p.textLength ?? 0,
        };
        bySet.set(d.set_id, [...(bySet.get(d.set_id) ?? []), file]);
      }
      return sets.rows.map((s) => ({ id: s.id, name: s.name, waveLabel: s.wave_label, source: s.source, files: bySet.get(s.id) ?? [], checks: s.checks ?? null }));
    });
  } catch {
    return [];
  }
}
