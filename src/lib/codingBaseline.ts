import type { PoolClient } from "pg";
import { sha256 } from "./qualCoding";

// The model's original coding of a transcript (Codex STAB-F01 to STAB-F03, batch 61; migration 0128).
//
// The stability check asks whether applying the same codebook, with the same model and prompt, to the
// same turns gives the same codes. Its first run is the model's own original application, kept here
// immutably. It is never rebuilt from coding_assignments, which also holds what the researcher changed
// by hand and what settling by majority changed. Contract: claude/coding-stability.md.

/**
 * Whether an application of the codebook left any requested decision unmade: a batch that failed
 * outright (no usable answer for at least one code) or a usable answer that omitted some requested
 * units (ANA-QUAL-001). An omitted decision is not a "does not meet the code" decision, so a coding with
 * a gap is incomplete, never a coding where the missing turns carry no code. The one definition used by
 * the document status after coding, the stored baseline and each stability pass.
 *
 * Counter-review on ANA-QUAL-001: a batch that failed outright used to be invisible to the ready or
 * incomplete decision, which looked only at incompleteBatches; one of three batches failing still read
 * as "ready". An explicit no-code decision (an empty but usable answer) is not a gap.
 */
export function codingHasGap(applied: { failedBatches: number; incompleteBatches: number }): boolean {
  return applied.failedBatches > 0 || applied.incompleteBatches > 0;
}

export type BaselineCode = {
  id: string;
  name: string;
  definition: string;
  inclusion: string | null;
  exclusion: string | null;
};

export type BaselineSegment = { id: string; index: number; role: string; text: string };

export type CodeFingerprint = { id: string; name: string; hash: string };

/** What each code meant when it was applied: its name, definition and criteria, per code id. */
export function codebookFingerprint(codes: BaselineCode[]): CodeFingerprint[] {
  return codes.map((c) => ({
    id: c.id,
    name: c.name,
    hash: sha256(
      JSON.stringify([c.name.trim(), c.definition.trim(), (c.inclusion ?? "").trim(), (c.exclusion ?? "").trim()]),
    ),
  }));
}

/** Which turns were coded: their ids, order, roles and text. The speaker label is left out because the
 * apply prompt does not show it; the role is in because it decides which turns are coded and which are
 * shown as the question asked. */
export function segmentationFingerprint(segments: BaselineSegment[]): string {
  const ordered = [...segments].sort((a, b) => a.index - b.index);
  return sha256(JSON.stringify(ordered.map((s) => [s.id, s.index, s.role, s.text])));
}

export type ModelBaseline = {
  id: string;
  model: string;
  promptHash: string;
  codebookFingerprint: CodeFingerprint[];
  segmentationFingerprint: string;
  totalBatches: number;
  failedBatches: number;
  incompleteBatches: number;
  /** segment id -> code ids the model gave it. A turn absent here had an explicit "no code" decision
   * only when the baseline is complete. */
  decisions: Record<string, string[]>;
  createdAt: string;
};

/** A model id that names a fixed release ends in its date (for example claude-sonnet-4-5-20250929). An
 * alias such as claude-sonnet-5 can be moved by the provider to a newer release without the name
 * changing, which this app cannot see. */
export function modelIsPinned(model: string): boolean {
  return /-\d{8}$/.test(model.trim());
}

export type MethodComparison = {
  /** unchanged: same model name, prompt and input preparation, codebook definitions and turns.
   * changed: at least one of those differs, listed in `changes`. */
  state: "unchanged" | "changed";
  changes: string[];
};

/** Compares the method a new application would use with the method of the baseline. */
export function compareMethod(
  baseline: ModelBaseline,
  current: { model: string; promptHash: string; codes: BaselineCode[]; segments: BaselineSegment[] },
): MethodComparison {
  const changes: string[] = [];
  if (baseline.model !== current.model)
    changes.push(`the model changed (the original coding used ${baseline.model}; a new run would use ${current.model})`);
  if (baseline.promptHash !== current.promptHash)
    changes.push("the coding instructions or the way turns are prepared for coding changed in an app update");
  const before = new Map(baseline.codebookFingerprint.map((c) => [c.id, c]));
  const now = codebookFingerprint(current.codes);
  const nowIds = new Set(now.map((c) => c.id));
  const added = now.filter((c) => !before.has(c.id)).map((c) => c.name);
  const removed = baseline.codebookFingerprint.filter((c) => !nowIds.has(c.id)).map((c) => c.name);
  const edited = now.filter((c) => before.has(c.id) && before.get(c.id)!.hash !== c.hash).map((c) => c.name);
  if (added.length > 0) changes.push(`theme${added.length === 1 ? "" : "s"} added since: ${added.join(", ")}`);
  if (removed.length > 0) changes.push(`theme${removed.length === 1 ? "" : "s"} removed since: ${removed.join(", ")}`);
  if (edited.length > 0)
    changes.push(`definition or criteria changed for: ${edited.join(", ")}`);
  if (baseline.segmentationFingerprint !== segmentationFingerprint(current.segments))
    changes.push("the transcript's turns changed");
  return { state: changes.length === 0 ? "unchanged" : "changed", changes };
}

/**
 * Whether the stability check can run against the stored original coding, and if not, why.
 * - migration_missing: migration 0128 is not applied, so no original coding is kept.
 * - unknown: no original model coding is recorded for this codebook (coded before batch 61, or coded
 *   by import rather than by the model). The current coding may hold hand changes, so it is not used.
 * - incomplete: the original application left decisions unmade (codingHasGap).
 * - changed: the method a new run would use differs from the original's.
 * - ready: complete, same method.
 */
export type BaselineState =
  | { state: "migration_missing" }
  | { state: "unknown" }
  | { state: "incomplete"; failedBatches: number; incompleteBatches: number; totalBatches: number }
  | { state: "changed"; changes: string[] }
  | { state: "ready" };

export function baselineState(
  available: boolean,
  baseline: ModelBaseline | null,
  current: { model: string; promptHash: string; codes: BaselineCode[]; segments: BaselineSegment[] },
): BaselineState {
  if (!available) return { state: "migration_missing" };
  if (!baseline) return { state: "unknown" };
  if (codingHasGap(baseline))
    return {
      state: "incomplete",
      failedBatches: baseline.failedBatches,
      incompleteBatches: baseline.incompleteBatches,
      totalBatches: baseline.totalBatches,
    };
  const method = compareMethod(baseline, current);
  if (method.state === "changed") return { state: "changed", changes: method.changes };
  return { state: "ready" };
}

/** The researcher-facing reason the check cannot run, or null when it can. */
export function baselineRefusal(s: BaselineState): string | null {
  switch (s.state) {
    case "ready":
      return null;
    case "migration_missing":
      return "The stability check needs database migration 0128, which keeps the model's original coding. Run it, apply the codebook again, then check stability.";
    case "unknown":
      return "The model's original coding of this transcript was not kept (it was coded before this was recorded, or the coding was imported), so it is unknown. The current coding may include your own changes, so it is not used in its place. Apply the codebook again to make a fresh, complete original, then check stability.";
    case "incomplete":
      return `The original coding is incomplete: of ${s.totalBatches} batches of turns, ${s.failedBatches} failed and ${s.incompleteBatches} came back with some turns left undecided. A missing decision is not a "no", so it cannot be compared. Apply the codebook again, then check stability.`;
    case "changed":
      return `A new run would not use the same method as the original coding: ${s.changes.join("; ")}. The differences found would come from that change, not from the model's consistency. Apply the codebook again, then check stability.`;
  }
}

export async function baselinesAvailable(client: PoolClient): Promise<boolean> {
  const r = await client.query<{ ok: boolean }>(
    "select to_regclass('public.coding_model_baselines') is not null and to_regclass('public.coding_stability_checks') is not null as ok",
  );
  return r.rows[0]?.ok === true;
}

type BaselineRow = {
  id: string;
  codebook_id: string;
  model: string;
  prompt_hash: string;
  codebook_fingerprint: CodeFingerprint[];
  segmentation_fingerprint: string;
  total_batches: number;
  failed_batches: number;
  incomplete_batches: number;
  decisions: Record<string, string[]>;
  created_at: string;
};

/** The latest original model coding of each codebook. Call only after baselinesAvailable. */
export async function loadLatestBaselines(
  client: PoolClient,
  codebookIds: string[],
): Promise<Map<string, ModelBaseline>> {
  const out = new Map<string, ModelBaseline>();
  if (codebookIds.length === 0) return out;
  const r = await client.query<BaselineRow>(
    `select distinct on (codebook_id) id, codebook_id, model, prompt_hash, codebook_fingerprint,
            segmentation_fingerprint, total_batches, failed_batches, incomplete_batches, decisions,
            created_at::text as created_at
       from coding_model_baselines where codebook_id = any($1::uuid[])
      order by codebook_id, created_at desc, id`,
    [codebookIds],
  );
  for (const row of r.rows)
    out.set(row.codebook_id, {
      id: row.id,
      model: row.model,
      promptHash: row.prompt_hash,
      codebookFingerprint: row.codebook_fingerprint,
      segmentationFingerprint: row.segmentation_fingerprint,
      totalBatches: row.total_batches,
      failedBatches: row.failed_batches,
      incompleteBatches: row.incomplete_batches,
      decisions: row.decisions,
      createdAt: row.created_at,
    });
  return out;
}

/**
 * Records the model's own coding of a codebook, inside the transaction that writes the same
 * assignments to coding_assignments, so the two describe one application. Returns false, writing
 * nothing, when migration 0128 is not applied (the coding itself still saves; the stability check
 * then reports that it needs the migration).
 */
export async function recordModelBaselineTx(
  client: PoolClient,
  row: {
    tenantId: string;
    runId: string;
    documentId: string;
    codebookId: string;
    model: string;
    promptHash: string;
    codes: BaselineCode[];
    segments: BaselineSegment[];
    applied: { totalBatches: number; failedBatches: number; incompleteBatches: number };
    decisions: Map<string, string[]>;
  },
): Promise<boolean> {
  if (!(await baselinesAvailable(client))) return false;
  await client.query(
    `insert into coding_model_baselines
       (tenant_id, run_id, document_id, codebook_id, model, prompt_hash, codebook_fingerprint,
        segmentation_fingerprint, total_batches, failed_batches, incomplete_batches, decisions)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      row.tenantId,
      row.runId,
      row.documentId,
      row.codebookId,
      row.model,
      row.promptHash,
      JSON.stringify(codebookFingerprint(row.codes)),
      segmentationFingerprint(row.segments),
      row.applied.totalBatches,
      row.applied.failedBatches,
      row.applied.incompleteBatches,
      JSON.stringify(Object.fromEntries(row.decisions)),
    ],
  );
  return true;
}

/**
 * How the coding now in force differs from the model's original coding: themes the researcher added or
 * removed by hand, or that settling by majority changed. A separate measure from the stability check,
 * which compares the model with itself. Counted over the turns and codes the baseline covers.
 */
export function changesSinceBaseline(
  baseline: ModelBaseline,
  current: Map<string, string[]>,
  segmentIds: string[],
  codeIds: string[],
): { added: number; removed: number; turns: number } {
  const codesHere = new Set(codeIds);
  let added = 0;
  let removed = 0;
  let turns = 0;
  for (const seg of segmentIds) {
    const was = new Set((baseline.decisions[seg] ?? []).filter((c) => codesHere.has(c)));
    const now = new Set((current.get(seg) ?? []).filter((c) => codesHere.has(c)));
    let changed = false;
    for (const c of now)
      if (!was.has(c)) {
        added += 1;
        changed = true;
      }
    for (const c of was)
      if (!now.has(c)) {
        removed += 1;
        changed = true;
      }
    if (changed) turns += 1;
  }
  return { added, removed, turns };
}
