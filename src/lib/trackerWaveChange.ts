// Wave-on-wave change on the brand tracking dashboard (R5 waves, approved by Grant, 30 October 2026): which wave a
// page is compared with, the change of each share against it, and the significance of that change. The contract is
// in claude/wave-change.md.
//
// - The waves offered are the project's included waves in the order of their owner (waves.ts projectWaves, read by
//   waveFiles.loadProjectWaves): excluded waves are never offered, undated waves are listed with the order basis.
// - "Compare with" is the previous included wave by default, any earlier included wave, or None (no change shown).
//   A chosen wave that is not an earlier included wave is not silently replaced by another: the page says why.
// - A change is this wave's unrounded share minus the compared wave's, in percentage points, only where both sides
//   are the same thing: the same brand code naming the same brand (trackerFigures.codeNamesDiffer) and the same
//   question (trackerFigures.questionDiffers: same variable, wording and answer codes), and the same answer code.
//   Never by label or position. Unknown or suppressed on either side: no change, with the reason.
// - Significance is the engine's (api/parse-stats-file.py share_change_tests): the waves are independent samples; a
//   two-proportion test on each wave's Kish effective base (weights allowed for), or, when a survey design is applied
//   in both waves, on each wave's design-based variance. Two-sided, p < 0.05, not adjusted for multiple comparisons.
//   A change that could not be tested says why, never "not significant"; a test that failed to run says so.
import { loadDocumentFile } from "./crosstabs";
import { runShareChangeTests, type ShareChangeSide } from "./parseStatsFile";
import { loadProjectWaves } from "./waveFiles";
import { waveOrderText, type OrderedWave, type ProjectWaves } from "./waves";
import { loadWaveContext, type WaveContext } from "./trackerWaveContext";
import type { ShareStat } from "./trackerFigures";

/** What the screen asks to compare with: the previous included wave, none, or one wave file by id. */
export type CompareChoice = "previous" | "none" | { documentId: string };

/** The compare choice as sent by the screen, checked at the boundary; null when it is not one. Absent is "previous". */
export function compareChoiceFrom(raw: unknown): CompareChoice | null {
  if (raw === undefined || raw === null || raw === "previous") return "previous";
  if (raw === "none") return "none";
  if (typeof raw === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) return { documentId: raw };
  return null;
}

export type WaveOption = { documentId: string; wave: string; filename: string; waveDate: string | null };

/** The waves the selector lists: the included waves in their owner's order, the order basis said, and the excluded
 * waves named only to say they are left out. `current` is this file's place in `included` (-1: not a wave). */
export type WaveList = { included: WaveOption[]; excluded: WaveOption[]; orderText: string; undated: string[]; current: number };

const option = (w: OrderedWave): WaveOption => ({ documentId: w.documentId, wave: w.wave, filename: w.filename, waveDate: w.waveDate });

export function waveListOf(waves: ProjectWaves, documentId: string): WaveList {
  return {
    included: waves.included.map(option),
    excluded: waves.excluded.map(option),
    orderText: waveOrderText(waves.basis),
    undated: waves.basis.kind === "upload" ? waves.basis.undated : [],
    current: waves.included.findIndex((w) => w.documentId === documentId),
  };
}

/** The wave a page is compared with. "none": there is none or it is not valid (the reason says which); "off": the
 * researcher chose None; "failed": its figures could not be read (never shown as no change). */
export type ComparedWave =
  | ({ status: "ok" } & WaveOption)
  | { status: "none"; reason: string }
  | { status: "off"; reason: string }
  | ({ status: "failed"; error: string } & WaveOption);

/** Which wave to compare with, from the project's waves and the choice. Pure. */
export function comparisonTarget(waves: ProjectWaves, documentId: string, choice: CompareChoice): { status: "target"; wave: OrderedWave } | Extract<ComparedWave, { status: "none" | "off" }> {
  if (choice === "none") return { status: "off", reason: "Compare with: None, so no change is shown." };
  const at = waves.included.findIndex((w) => w.documentId === documentId);
  if (at < 0) return { status: "none", reason: "This file is not an included wave of this project, so there is no earlier wave to compare with." };
  if (choice === "previous") return at === 0 ? { status: "none", reason: "This is the earliest wave of this project." } : { status: "target", wave: waves.included[at - 1] };
  const chosen = waves.included.findIndex((w) => w.documentId === choice.documentId);
  if (chosen < 0) return { status: "none", reason: "The wave chosen to compare with is not an included wave of this project (it may have been left out). Choose another wave to compare with." };
  if (chosen >= at) return { status: "none", reason: "The wave chosen to compare with is not earlier than this one. Choose an earlier wave." };
  return { status: "target", wave: waves.included[chosen] };
}

/** The significance of one change. */
export type ChangeTest =
  | { status: "tested"; z: number; p: number; significant: boolean; direction: -1 | 0 | 1; method: "pooled_effective_base" | "design" }
  | { status: "untested"; reason: string }
  | { status: "failed"; reason: string };

/** One share's change against the compared wave. */
export type ShareChange = {
  current: number | null;
  previous: number | null;
  /** current minus previous, unrounded, in percentage points; null with `reason` when not compared. */
  changePp: number | null;
  reason?: string;
  test?: ChangeTest;
};

/** A share as a page reads it: unrounded percentage, unweighted base, and its sampling facts. */
export type ShareSide = { share: number | null; base: number | null; reason?: string; stat?: ShareStat };

/** A change waiting for its test: the change and the two sides it was computed from. */
export type TestJob = { change: ShareChange; current: ShareSide; previous: ShareSide; untestable?: string };

/**
 * The change of one share. `withheld` is the identity rule's reason (a different brand or question); `previous`
 * undefined means the compared wave has no such figure. Returns the change and, when it has a value, the job that
 * tests it.
 */
export function shareChange(current: ShareSide, previous: ShareSide | undefined, withheld: string | null, untestable?: string): { change: ShareChange; job: TestJob | null } {
  if (withheld) return { change: { current: current.share, previous: null, changePp: null, reason: withheld }, job: null };
  if (!previous) return { change: { current: current.share, previous: null, changePp: null, reason: "Not in the compared wave." }, job: null };
  if (current.share === null || previous.share === null) {
    const why = current.share === null ? current.reason : previous.reason;
    return { change: { current: current.share, previous: previous.share, changePp: null, reason: `Not available in ${current.share === null ? "this" : "the compared"} wave${why ? `: ${why}` : "."}` }, job: null };
  }
  const change: ShareChange = { current: current.share, previous: previous.share, changePp: current.share - previous.share };
  return { change, job: { change, current, previous, ...(untestable ? { untestable } : {}) } };
}

const sideOf = (s: ShareSide): ShareChangeSide => ({ pct: s.share, n: s.base, nEff: s.stat?.nEff ?? null, se: s.stat?.se ?? null, designDf: s.stat?.designDf ?? null });

/**
 * Tests every job's change in one engine request and writes `test` on each change. A job the app can already tell is
 * not testable (no effective base from an older engine, a design applied without a design-based variance for this
 * figure, a page's own rule such as a small base) is "untested" with the reason; a failed engine request makes every
 * pending test "failed" with the reason. Never throws for a failed test: the changes stand without one.
 */
export async function attachTests(jobs: TestJob[], signedFor: { storagePath: string; sourceFilename: string }): Promise<{ failed: string | null; designBased: boolean }> {
  const pending: { id: string; job: TestJob }[] = [];
  for (const job of jobs) {
    if (job.untestable) job.change.test = { status: "untested", reason: job.untestable };
    else if (!job.current.stat || !job.previous.stat) job.change.test = { status: "untested", reason: "The effective base of one of the two waves is not known, so the change is not tested." };
    else if ((job.current.stat.designApplied && job.current.stat.se === null) || (job.previous.stat.designApplied && job.previous.stat.se === null))
      job.change.test = { status: "untested", reason: "A survey design is applied, and no design-based variance is available for this figure, so the change is not tested." };
    else pending.push({ id: String(pending.length), job });
  }
  if (pending.length === 0) return { failed: null, designBased: false };
  try {
    const reply = await runShareChangeTests(pending.map((p) => ({ id: p.id, previous: sideOf(p.job.previous), current: sideOf(p.job.current) })), signedFor);
    const byId = new Map(reply.results.map((r) => [r.id, r]));
    let designBased = false;
    for (const p of pending) {
      const r = byId.get(p.id);
      if (!r) p.job.change.test = { status: "failed", reason: "The engine returned no result for this change." };
      else if (!r.tested || r.z === null || r.p === null || r.method === null) p.job.change.test = { status: "untested", reason: r.reason ?? "Not tested." };
      else {
        designBased ||= r.method === "design";
        p.job.change.test = { status: "tested", z: r.z, p: r.p, significant: r.significant, direction: r.direction, method: r.method };
      }
    }
    return { failed: null, designBased };
  } catch (e) {
    const reason = `The significance test could not be run: ${e instanceof Error ? e.message : String(e)}`;
    for (const p of pending) p.job.change.test = { status: "failed", reason };
    return { failed: reason, designBased: false };
  }
}

/** The one line each page states about the test (Grant's wording). */
export const TEST_LINE = "Change marked when a two-sample test on effective bases gives p < 0.05; not adjusted for multiple comparisons.";
export const SRS_NOTE = "Weights enter through each wave's effective base (Kish); the test assumes simple random sampling within each wave.";
export const DESIGN_NOTE = "Where a survey design is set in both waves, each wave's design-based variance is used (t on the design degrees of freedom).";

/** What a page says about its comparison: the wave compared with, and the test's line (null when nothing is compared). */
export type WaveComparison<C> = {
  compared: ComparedWave;
  waves: WaveList;
  changes: C | null;
  test: { line: string; note: string; failed: string | null } | null;
};

/**
 * A page for one wave and the same page for the wave it is compared with, each from its own context (the programme's
 * choices resolved against that wave's file). The current page failing throws (the page fails with its reason); the
 * compared page failing is "failed" with the reason, and the current page still shows.
 */
export async function pagesToCompare<P>(
  tenantId: string,
  runId: string,
  documentId: string,
  choice: CompareChoice,
  load: (documentId: string, ctx: WaveContext) => Promise<P>,
): Promise<{ page: P; ctx: WaveContext; waves: ProjectWaves; compared: ComparedWave; previous: { page: P; ctx: WaveContext } | null }> {
  const waves = await loadProjectWaves(tenantId, runId);
  const target = comparisonTarget(waves, documentId, choice);
  const current = (async () => {
    const ctx = await loadWaveContext(tenantId, runId, documentId);
    return { ctx, page: await load(documentId, ctx) };
  })();
  const previous =
    target.status === "target"
      ? (async () => {
          const ctx = await loadWaveContext(tenantId, runId, target.wave.documentId);
          return { ctx, page: await load(target.wave.documentId, ctx) };
        })().then(
          (v) => ({ ok: true as const, v }),
          (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }),
        )
      : null;
  const [cur, prev] = await Promise.all([current, previous]);
  let compared: ComparedWave;
  if (target.status !== "target") compared = target;
  else if (prev && prev.ok) compared = { status: "ok", ...option(target.wave) };
  else compared = { status: "failed", ...option(target.wave), error: prev && !prev.ok ? prev.error : "Not read." };
  return { page: cur.page, ctx: cur.ctx, waves, compared, previous: prev && prev.ok ? prev.v : null };
}

/** Runs the tests of a page's changes and states the line, signed for the current wave's file. */
export async function testedComparison<C>(tenantId: string, runId: string, documentId: string, waves: ProjectWaves, compared: ComparedWave, changes: C | null, jobs: TestJob[]): Promise<WaveComparison<C>> {
  const list = waveListOf(waves, documentId);
  if (changes === null || compared.status !== "ok") return { compared, waves: list, changes: null, test: null };
  const doc = await loadDocumentFile(tenantId, runId, documentId);
  const { failed, designBased } = await attachTests(jobs, { storagePath: doc.storage_path, sourceFilename: doc.source_filename });
  return { compared, waves: list, changes, test: { line: TEST_LINE, note: designBased ? `${DESIGN_NOTE} Otherwise: ${SRS_NOTE.charAt(0).toLowerCase()}${SRS_NOTE.slice(1)}` : SRS_NOTE, failed } };
}
