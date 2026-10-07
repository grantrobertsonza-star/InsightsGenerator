import { isMissing, type CellValue } from "./dataQuality";
import type { SegmentRole } from "./qualCoding";

// Pure helpers for the checks that sit on top of a coded transcript:
// agreement with a researcher's own coding, counts with their denominators,
// focus group echo detection, the respondent by theme matrix and its join to
// closed survey answers, and validation of what the model proposes. No model
// calls and no database here, so all of it can be tested directly.

export type AnalysisSegment = {
  id: string;
  index: number;
  speaker: string | null;
  role: SegmentRole;
  text: string;
};

// --- Agreement with the researcher ---------------------------------------

export type AgreementCounts = {
  n: number;
  bothYes: number; // model coded it, researcher coded it
  modelOnly: number;
  researcherOnly: number;
  bothNo: number;
  agreement: number | null; // share of turns where the two agree
  kappa: number | null;
};

/**
 * Cohen's kappa for one code over the turns a researcher has judged. Each
 * pair is "did the model apply the code" against "does the researcher say it
 * applies". Kappa is null when it cannot be defined: no turns, or one side
 * said the same thing on every turn so chance agreement is already total.
 */
export function cohenKappa(
  pairs: { model: boolean; researcher: boolean }[],
): AgreementCounts {
  let bothYes = 0;
  let modelOnly = 0;
  let researcherOnly = 0;
  let bothNo = 0;
  for (const p of pairs) {
    if (p.model && p.researcher) bothYes += 1;
    else if (p.model) modelOnly += 1;
    else if (p.researcher) researcherOnly += 1;
    else bothNo += 1;
  }
  const n = pairs.length;
  if (n === 0) {
    return {
      n,
      bothYes,
      modelOnly,
      researcherOnly,
      bothNo,
      agreement: null,
      kappa: null,
    };
  }
  const observed = (bothYes + bothNo) / n;
  const modelYes = (bothYes + modelOnly) / n;
  const researcherYes = (bothYes + researcherOnly) / n;
  const expected =
    modelYes * researcherYes + (1 - modelYes) * (1 - researcherYes);
  const kappa = expected >= 1 ? null : (observed - expected) / (1 - expected);
  return {
    n,
    bothYes,
    modelOnly,
    researcherOnly,
    bothNo,
    agreement: observed,
    kappa,
  };
}

// Landis and Koch's labels. They are conventions, not thresholds with any
// statistical standing, and the UI says so.
export function kappaBand(kappa: number | null): string {
  if (kappa === null) return "Not defined";
  if (kappa < 0) return "Worse than chance";
  if (kappa <= 0.2) return "Slight";
  if (kappa <= 0.4) return "Fair";
  if (kappa <= 0.6) return "Moderate";
  if (kappa <= 0.8) return "Substantial";
  return "Almost perfect";
}

export const MIN_TURNS_FOR_KAPPA = 20;
export const MIN_POSITIVES_FOR_KAPPA = 3;

/**
 * Whether a kappa rests on enough to be worth reading. With few turns, or
 * with the code applied (by either side) to only a handful of them, one
 * disagreement moves kappa a long way.
 */
export function kappaCaveat(c: AgreementCounts): string | null {
  if (c.n < MIN_TURNS_FOR_KAPPA)
    return `Only ${c.n} turn${c.n === 1 ? "" : "s"} judged; kappa is unstable below ${MIN_TURNS_FOR_KAPPA}.`;
  const modelYes = c.bothYes + c.modelOnly;
  const researcherYes = c.bothYes + c.researcherOnly;
  if (
    modelYes < MIN_POSITIVES_FOR_KAPPA ||
    researcherYes < MIN_POSITIVES_FOR_KAPPA
  )
    return "The code applies to very few of the judged turns, so kappa is unstable.";
  return null;
}

// FNV-1a, so the same seed and ids always give the same order.
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Picks the participant turns a researcher is asked to code blind. The
 * sample is deliberately not random: it takes a few turns the model gave each
 * code (so every code can be checked), some it gave no code (to catch
 * misses), then fills the rest by seeded order. Because positives are
 * over-represented, agreement here describes how the codebook behaves on
 * these turns and not how often the model is right across the transcript.
 */
export function selectCalibrationSample(
  segments: { id: string; index: number; role: SegmentRole; codes: number[] }[],
  codeCount: number,
  options: { size?: number; seed?: string; perCode?: number } = {},
): string[] {
  const size = options.size ?? 24;
  const seed = options.seed ?? "calibration";
  const perCode = options.perCode ?? 2;
  const pool = segments
    .filter((s) => s.role !== "moderator")
    .map((s) => ({ ...s, rank: hash(`${seed}:${s.id}`) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index);
  const chosen = new Map<string, number>();
  const take = (s: { id: string; index: number }) => {
    if (chosen.size < size && !chosen.has(s.id)) chosen.set(s.id, s.index);
  };
  for (let code = 1; code <= codeCount; code++) {
    let got = 0;
    for (const s of pool) {
      if (got >= perCode) break;
      if (s.codes.includes(code) && !chosen.has(s.id)) {
        take(s);
        got += 1;
      }
    }
  }
  const unassignedTarget = Math.max(2, Math.floor(size / 3));
  let unassigned = 0;
  for (const s of pool) {
    if (unassigned >= unassignedTarget) break;
    if (s.codes.length === 0 && !chosen.has(s.id)) {
      take(s);
      unassigned += 1;
    }
  }
  for (const s of pool) take(s);
  return [...chosen.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

// --- Counts with denominators --------------------------------------------

export const ECHO_WINDOW = 4; // turns back to look for who said it first
export const ECHO_MAX_WORDS = 15;
export const ECHO_MIN_OVERLAP = 0.5;
export const EPISODE_GAP = 3; // turns between coded turns that still count as one stretch

export type CodeStats = {
  turns: number; // participant turns the code was applied to
  participantTurns: number; // all participant turns in the transcript
  speakersWith: number | null; // null when the transcript has no speaker labels
  speakersTotal: number | null;
  episodes: number; // runs of coded turns, a gap of more than EPISODE_GAP turns starts a new one
  echoTurns: number; // focus groups only, otherwise 0
  independentSpeakers: number | null; // focus groups only: speakers with at least one turn that is not an echo
};

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean);
}

function overlap(a: string, b: string): number {
  const x = new Set(words(a).filter((w) => w.length > 2));
  const y = new Set(words(b).filter((w) => w.length > 2));
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return shared / (x.size + y.size - shared);
}

/**
 * Turns that look like an echo of another speaker's coded turn: a different
 * speaker said it within ECHO_WINDOW turns before, and this turn is either
 * short (agreement, "same for me") or shares half its words with that turn.
 * It is a flag for a researcher to look at, not a verdict; a short reply can
 * be an independent view and a long one can be borrowed.
 */
export function detectEchoes(
  ordered: AnalysisSegment[],
  codedIds: Set<string>,
): Set<string> {
  const echoes = new Set<string>();
  for (let i = 0; i < ordered.length; i++) {
    const turn = ordered[i];
    if (!codedIds.has(turn.id) || !turn.speaker) continue;
    for (let j = i - 1; j >= 0 && i - j <= ECHO_WINDOW; j--) {
      const earlier = ordered[j];
      if (
        !codedIds.has(earlier.id) ||
        !earlier.speaker ||
        earlier.speaker === turn.speaker
      )
        continue;
      if (
        words(turn.text).length <= ECHO_MAX_WORDS ||
        overlap(turn.text, earlier.text) >= ECHO_MIN_OVERLAP
      ) {
        echoes.add(turn.id);
        break;
      }
    }
  }
  return echoes;
}

export function computeCodeStats(input: {
  segments: AnalysisSegment[]; // whole transcript in order
  assignments: Map<string, number[]>; // segment id to 1-based code numbers
  codeCount: number;
  focusGroup: boolean;
}): CodeStats[] {
  const ordered = [...input.segments].sort((a, b) => a.index - b.index);
  const participants = ordered.filter((s) => s.role !== "moderator");
  const labelled = new Set(
    participants.map((s) => s.speaker).filter((s): s is string => Boolean(s)),
  );
  const hasLabels = labelled.size > 0;
  const stats: CodeStats[] = [];
  for (let code = 1; code <= input.codeCount; code++) {
    const coded = ordered.filter(
      (s) =>
        s.role !== "moderator" && input.assignments.get(s.id)?.includes(code),
    );
    const codedIds = new Set(coded.map((s) => s.id));
    const position = new Map(ordered.map((s, i) => [s.id, i]));
    let episodes = 0;
    let last = -Infinity;
    for (const s of coded) {
      const at = position.get(s.id)!;
      if (at - last > EPISODE_GAP) episodes += 1;
      last = at;
    }
    const echoes = input.focusGroup
      ? detectEchoes(ordered, codedIds)
      : new Set<string>();
    const speakers = new Set(
      coded.map((s) => s.speaker).filter((s): s is string => Boolean(s)),
    );
    const independent = new Set(
      coded
        .filter((s) => !echoes.has(s.id))
        .map((s) => s.speaker)
        .filter((s): s is string => Boolean(s)),
    );
    stats.push({
      turns: coded.length,
      participantTurns: participants.length,
      speakersWith: hasLabels ? speakers.size : null,
      speakersTotal: hasLabels ? labelled.size : null,
      episodes,
      echoTurns: echoes.size,
      independentSpeakers:
        hasLabels && input.focusGroup ? independent.size : null,
    });
  }
  return stats;
}

/** "5 of 8 participants", "1 of 1 group". */
export function formatCount(n: number, total: number, noun: string): string {
  return `${n} of ${total} ${noun}${total === 1 ? "" : "s"}`;
}

// --- Respondents by theme ------------------------------------------------

export type Respondent = {
  key: string; // speaker label, or "" for an unlabelled transcript
  label: string;
  caseKey: string | null;
  turns: number;
  codes: Map<number, number>; // 1-based code number to turns
};

export function buildRespondents(
  segments: AnalysisSegment[],
  assignments: Map<string, number[]>,
  caseKeys: Map<string, string>,
): Respondent[] {
  const byKey = new Map<string, Respondent>();
  const participants = segments.filter((s) => s.role !== "moderator");
  const labelled = participants.some((s) => s.speaker);
  for (const s of participants) {
    const key = labelled ? (s.speaker ?? "") : "";
    if (labelled && !s.speaker) continue;
    let r = byKey.get(key);
    if (!r) {
      r = {
        key,
        label: key || "Whole transcript",
        caseKey: caseKeys.get(key) ?? null,
        turns: 0,
        codes: new Map(),
      };
      byKey.set(key, r);
    }
    r.turns += 1;
    for (const code of assignments.get(s.id) ?? [])
      r.codes.set(code, (r.codes.get(code) ?? 0) + 1);
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

// --- Closed answers ------------------------------------------------------

export function parseNumber(value: CellValue): number | null {
  if (isMissing(value)) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).replace(/,/g, "").replace(/%$/, "").trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export type NumericVariable = { name: string; median: number; count: number };

/** Columns where at least 90% of the non-missing values read as numbers. */
export function numericVariables(
  headers: string[],
  rows: CellValue[][],
): NumericVariable[] {
  const out: NumericVariable[] = [];
  headers.forEach((name, col) => {
    const present = rows.filter((r) => !isMissing(r[col]));
    if (present.length === 0) return;
    const values = present
      .map((r) => parseNumber(r[col]))
      .filter((v): v is number => v !== null);
    if (values.length / present.length < 0.9 || values.length < 3) return;
    out.push({ name, median: median(values), count: values.length });
  });
  return out;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The survey row whose case column equals the respondent's case key. */
export function findCaseRow(
  headers: string[],
  rows: CellValue[][],
  caseColumn: string,
  caseKey: string,
): { row: CellValue[] | null; matches: number } {
  const col = headers.indexOf(caseColumn);
  if (col < 0 || !caseKey.trim()) return { row: null, matches: 0 };
  const wanted = caseKey.trim().toLowerCase();
  const hits = rows.filter(
    (r) =>
      String(r[col] ?? "")
        .trim()
        .toLowerCase() === wanted,
  );
  return { row: hits[0] ?? null, matches: hits.length };
}

export type VariableLink = {
  codeName: string;
  variable: string;
  direction: "higher" | "lower";
};

export type Dissonance = {
  respondent: string;
  codeName: string;
  variable: string;
  value: number;
  median: number;
  direction: "higher" | "lower";
};

/**
 * Respondents who voiced a theme but answered the linked closed question on
 * the wrong side of the median for what the theme implies. "Higher" means
 * voicing the theme goes with higher answers, so a value below the median is
 * dissonant. A value on the median is never flagged, and a respondent
 * with no matching survey row, or no usable value, is counted as unmatched
 * rather than assumed consistent. It is a prompt to reread the transcript
 * (a say-do gap, a misread question, or a wrong code), not a finding.
 */
export function flagDissonance(input: {
  respondents: Respondent[];
  codeNames: string[]; // index 0 is code number 1
  links: VariableLink[];
  headers: string[];
  rows: CellValue[][];
  caseColumn: string;
}): { flags: Dissonance[]; checked: number; unmatched: number } {
  const flags: Dissonance[] = [];
  let checked = 0;
  let unmatched = 0;
  const profiles = new Map(
    numericVariables(input.headers, input.rows).map((v) => [v.name, v]),
  );
  for (const link of input.links) {
    const code = input.codeNames.indexOf(link.codeName) + 1;
    const col = input.headers.indexOf(link.variable);
    const profile = profiles.get(link.variable);
    if (code < 1 || col < 0 || !profile) continue;
    for (const r of input.respondents) {
      if (!r.codes.has(code)) continue;
      const { row } = r.caseKey
        ? findCaseRow(input.headers, input.rows, input.caseColumn, r.caseKey)
        : { row: null };
      const value = row ? parseNumber(row[col]) : null;
      if (value === null) {
        unmatched += 1;
        continue;
      }
      checked += 1;
      const wrong =
        (link.direction === "higher" && value < profile.median) ||
        (link.direction === "lower" && value > profile.median);
      if (wrong)
        flags.push({
          respondent: r.label,
          codeName: link.codeName,
          variable: link.variable,
          value,
          median: profile.median,
          direction: link.direction,
        });
    }
  }
  return { flags, checked, unmatched };
}

// --- What the model proposes ---------------------------------------------

export type LinkProposal = {
  code: number;
  variable: string;
  direction: "higher" | "lower";
  rationale: string;
};

export const MAX_LINK_PROPOSALS = 15;

/**
 * Keeps only proposals that point at a real code and a real numeric column,
 * with a direction and a reason. The model's own wording of the column is
 * snapped back to the exact header, so a link can never name a variable that
 * is not in the table.
 */
export function validateLinkProposals(
  raw: unknown,
  codeCount: number,
  variables: string[],
): LinkProposal[] {
  if (!Array.isArray(raw)) return [];
  const byLower = new Map(variables.map((v) => [v.trim().toLowerCase(), v]));
  const seen = new Set<string>();
  const out: LinkProposal[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    const code = item?.code;
    const variable =
      typeof item?.variable === "string"
        ? byLower.get(item.variable.trim().toLowerCase())
        : undefined;
    const direction = item?.direction;
    const rationale =
      typeof item?.rationale === "string" ? item.rationale.trim() : "";
    if (
      typeof code !== "number" ||
      !Number.isInteger(code) ||
      code < 1 ||
      code > codeCount ||
      !variable ||
      (direction !== "higher" && direction !== "lower") ||
      !rationale
    )
      continue;
    const key = `${code}|${variable}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code, variable, direction, rationale: rationale.slice(0, 400) });
    if (out.length >= MAX_LINK_PROPOSALS) break;
  }
  return out;
}

export type NegativeCaseProposal = {
  code: number;
  index: number;
  reason: string;
};

export const MAX_NEGATIVE_CASES_PER_CODE = 3;

/**
 * Reads the negative case search: turns the model says contradict or
 * qualify a code. An index that was not among the turns shown, a code
 * outside the codebook, a turn the model did not explain, or a duplicate is
 * dropped, and each code keeps at most MAX_NEGATIVE_CASES_PER_CODE.
 */
export function parseNegativeCases(
  raw: unknown,
  allowedIndexes: Set<number>,
  codeCount: number,
): NegativeCaseProposal[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const perCode = new Map<number, number>();
  const out: NegativeCaseProposal[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    const code = item?.code;
    const index = item?.index;
    const reason = typeof item?.reason === "string" ? item.reason.trim() : "";
    if (
      typeof code !== "number" ||
      !Number.isInteger(code) ||
      code < 1 ||
      code > codeCount ||
      typeof index !== "number" ||
      !allowedIndexes.has(index) ||
      !reason
    )
      continue;
    const key = `${code}|${index}`;
    if (seen.has(key)) continue;
    if ((perCode.get(code) ?? 0) >= MAX_NEGATIVE_CASES_PER_CODE) continue;
    seen.add(key);
    perCode.set(code, (perCode.get(code) ?? 0) + 1);
    out.push({ code, index, reason: reason.slice(0, 300) });
  }
  return out;
}

/**
 * The session a speaker belongs to when a file holds several ("P3 (Focus
 * group 2)" gives "Focus group 2"). Null for a plain label, which means the
 * file itself is the group.
 */
export function sessionOfSpeaker(speaker: string | null): string | null {
  if (!speaker) return null;
  const m = /\(([^()]+)\)\s*$/.exec(speaker);
  return m ? m[1].trim() : null;
}
