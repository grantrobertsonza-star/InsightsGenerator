// Related output sets and wave comparison. Pure: files in, suggestions and
// draft findings out.
//
// Comparing waves means matching the same model term (or the same segment)
// in two sets and asking whether the change is larger than sampling error
// allows. The test assumes two independent samples, and says so.

import {
  cell,
  colIndex,
  fmt,
  isIntercept,
  isRobustnessPath,
  isThreshold,
  nk,
  num,
  readCoefRows,
  type Caveat,
  type DraftFinding,
  type SetFileData,
} from "./outputAnalysis";

// --- Related sets -------------------------------------------------------------------

export type SetSummary = { id: string; name: string; waveLabel: string | null; files: { name: string }[] };

export type RelatedSuggestion = {
  aId: string;
  bId: string;
  kind: "same_output_again" | "parts_of_one_output";
  shared: number;
  reason: string;
};

/** A file name reduced to what stays the same between waves: wave tokens, years and version numbers dropped. */
export function waveStem(name: string): string {
  return nk(name.replace(/\.[^.]+$/, ""))
    .split(" ")
    .filter((w) => !/^(w\d+|wave\d*|v\d+|20\d\d|19\d\d|baseline|endline|midline|round\d*|r\d+)$/.test(w))
    .join(" ");
}

const commonPrefix = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

export function suggestRelated(sets: SetSummary[]): RelatedSuggestion[] {
  const out: RelatedSuggestion[] = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i];
      const b = sets[j];
      const sa = new Set(a.files.map((f) => waveStem(f.name)).filter(Boolean));
      const sb = new Set(b.files.map((f) => waveStem(f.name)).filter(Boolean));
      if (sa.size === 0 || sb.size === 0) continue;
      const shared = [...sa].filter((x) => sb.has(x)).length;
      const overlap = shared / Math.min(sa.size, sb.size);
      if (overlap >= 0.6) {
        out.push({
          aId: a.id,
          bId: b.id,
          kind: "same_output_again",
          shared,
          reason: `${shared} of ${Math.min(sa.size, sb.size)} file names match once wave, year and version labels are ignored, so "${b.name}" looks like the same analysis run on another wave or date.`,
        });
      } else if (overlap <= 0.1) {
        const na = nk(a.name);
        const nb = nk(b.name);
        const sameLabel = !!a.waveLabel && a.waveLabel === b.waveLabel;
        if (sameLabel || commonPrefix(na, nb) >= 8) {
          out.push({
            aId: a.id,
            bId: b.id,
            kind: "parts_of_one_output",
            shared,
            reason: sameLabel
              ? `Both sets carry the label "${a.waveLabel}" and share no files, so they may be two parts of one output.`
              : `The names start alike and the sets share no files, so they may be two parts of one output.`,
          });
        }
      }
    }
  }
  return out;
}

// --- Wave comparison ---------------------------------------------------------------------

export type WaveSet = { id: string; label: string; files: SetFileData[] };

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}
export const twoSidedP = (z: number) => 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));

const CHANCE = 1.96;
const MAX_MODELS_PER_FILE = 6;

function note(f: SetFileData, severity: Caveat["severity"], text: string): Caveat {
  return { severity, text, fileId: f.id, fileName: f.name, modelNumber: null, modelId: null };
}

const INDEPENDENCE =
  "The test treats the two waves as independent samples. If the same people were followed over time, the standard error of the change differs and this test may be too cautious or too loose.";
const LIKE_FOR_LIKE =
  "The comparison is only like for like if the questions, weights and model specification were the same in both waves. A change in any of them can look like a change in the population.";

type Match = { stem: string; family: string; earlier: SetFileData; later: SetFileData };

function matchFiles(a: SetFileData[], b: SetFileData[], kinds: string[]): Match[] {
  const usable = (f: SetFileData) => f.table && f.role === "evidence" && kinds.includes(f.kind) && !isRobustnessPath(f.path);
  const out: Match[] = [];
  const bm = new Map<string, SetFileData>();
  for (const f of b.filter(usable)) bm.set(`${waveStem(f.name)}|${nk(f.family)}`, f);
  for (const f of a.filter(usable)) {
    const k = `${waveStem(f.name)}|${nk(f.family)}`;
    const m = bm.get(k);
    if (m) out.push({ stem: waveStem(f.name), family: f.family, earlier: f, later: m });
  }
  return out;
}

const orOf = (e: number) => (Math.exp(e) >= 100 ? Math.exp(e).toFixed(0) : Math.exp(e).toFixed(2));

export function compareWaves(earlier: WaveSet, later: WaveSet): { findings: DraftFinding[]; notes: string[] } {
  const findings: DraftFinding[] = [];
  const notes: string[] = [];
  const L = later.label;
  const E = earlier.label;

  // Models
  const modelPairs = matchFiles(earlier.files, later.files, ["model_coefficients"]);
  for (const m of modelPairs) {
    const ra = readCoefRows(m.earlier.table!);
    const rb = readCoefRows(m.later.table!);
    const groupsOf = (rows: typeof ra) => new Set(rows.map((r) => r.model ?? "")).size;
    if (groupsOf(ra) > MAX_MODELS_PER_FILE || groupsOf(rb) > MAX_MODELS_PER_FILE) continue;
    const key = (r: (typeof ra)[number]) => `${nk(r.model ?? "")}|${nk(r.term)}`;
    const mapB = new Map(rb.map((r) => [key(r), r]));
    type Row = { term: string; e1: number; e2: number; d: number; z: number; p1: number | null; p2: number | null };
    const rows: Row[] = [];
    let unmatched = 0;
    for (const r of ra) {
      if (isIntercept(r.term) || isThreshold(r.term) || r.estimate === null || !r.se) continue;
      const o = mapB.get(key(r));
      if (!o || o.estimate === null || !o.se) {
        unmatched++;
        continue;
      }
      const d = o.estimate - r.estimate;
      const sd = Math.sqrt(r.se ** 2 + o.se ** 2);
      rows.push({ term: r.term, e1: r.estimate, e2: o.estimate, d, z: sd > 0 ? d / sd : 0, p1: r.p, p2: o.p });
    }
    if (rows.length === 0) continue;
    const changed = rows.filter((x) => Math.abs(x.z) >= CHANCE);
    const label = m.later.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\b(coefficients?|coefs?)\b/i, "").trim();
    const top = [...rows]
      .filter((x) => (x.p1 !== null && x.p1 < 0.05) || (x.p2 !== null && x.p2 < 0.05) || Math.abs(x.z) >= CHANCE)
      .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
      .slice(0, 4);
    const bits = top.map(
      (x) => `${x.term} (OR ${orOf(x.e1)} then ${orOf(x.e2)}; change in log-odds ${fmt(x.d, 2)}, z = ${fmt(x.z, 1)}${Math.abs(x.z) >= CHANCE ? "" : ", within chance"})`,
    );
    const text =
      changed.length === 0
        ? `${label}, ${L} against ${E}: none of the ${rows.length} shared terms changed by more than sampling error would explain (|z| below ${CHANCE}). ${bits.length > 0 ? `The closest were ${bits.join("; ")}.` : ""}`.trim()
        : `${label}, ${L} against ${E}: ${changed.length} of ${rows.length} shared terms changed by more than sampling error would explain. The largest were ${bits.join("; ")}.`;
    const caveats: Caveat[] = [note(m.later, "info", INDEPENDENCE), note(m.later, "info", LIKE_FOR_LIKE), note(m.later, "info", "With this many terms, a few will cross |z| 1.96 by chance alone; read single borderline changes with care.")];
    if (unmatched > 0) caveats.push(note(m.later, "info", `${unmatched} terms were in ${E} but not in ${L} and could not be compared.`));
    findings.push({
      sourceFileId: m.later.id,
      text,
      theme: `Change: ${label}`,
      patternType: "trend",
      stats: { kind: "wave_change_model", earlier: E, later: L, shared: rows.length, changed: changed.length, top: top.map((x) => ({ term: x.term, d: x.d, z: x.z })) },
      caveats,
    });
  }

  // Proportions
  const propPairs = matchFiles(earlier.files, later.files, ["proportions"]);
  for (const m of propPairs) {
    const ta = m.earlier.table!;
    const tb = m.later.table!;
    const cols = (t: typeof ta) => ({
      seg: colIndex(t, /^segment var/, /^variable$/, /^segment$/),
      lvl: colIndex(t, /^segment level/, /^level$/, /^category$/),
      val: colIndex(t, /^prop/, /^percent/, /^pct/, /^share$/, /^estimate$/),
      se: colIndex(t, /^se\b/, /std error/),
      out: colIndex(t, /^outcome$/),
    });
    const ca = cols(ta);
    const cb = cols(tb);
    if ([ca.seg, ca.lvl, ca.val, ca.se, cb.seg, cb.lvl, cb.val, cb.se].some((i) => i < 0)) continue;
    const kf = (r: string[], c: ReturnType<typeof cols>) => `${nk(cell(r, c.seg))}|${nk(cell(r, c.lvl))}|${c.out >= 0 ? nk(cell(r, c.out)) : ""}`;
    const mapB = new Map(tb.rows.map((r) => [kf(r, cb), r]));
    const unit = /pct|percent/.test(nk(ta.headers[ca.val])) ? "%" : "";
    type PRow = { seg: string; level: string; v1: number; v2: number; d: number; z: number };
    const rows: PRow[] = [];
    for (const r of ta.rows) {
      const o = mapB.get(kf(r, ca));
      if (!o) continue;
      const v1 = num(r[ca.val]);
      const v2 = num(o[cb.val]);
      const s1 = num(r[ca.se]);
      const s2 = num(o[cb.se]);
      if (v1 === null || v2 === null || s1 === null || s2 === null) continue;
      const sd = Math.sqrt(s1 ** 2 + s2 ** 2);
      if (sd <= 0) continue;
      rows.push({ seg: cell(r, ca.seg), level: cell(r, ca.lvl), v1, v2, d: v2 - v1, z: (v2 - v1) / sd });
    }
    if (rows.length === 0) continue;
    const changed = rows.filter((x) => Math.abs(x.z) >= CHANCE).sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    const label = m.later.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
    const bits = changed.slice(0, 4).map((x) => `${x.level} ${x.d >= 0 ? "rose" : "fell"} from ${fmt(x.v1, 1)}${unit} to ${fmt(x.v2, 1)}${unit} (${x.d >= 0 ? "+" : ""}${fmt(x.d, 1)}, z = ${fmt(x.z, 1)})`);
    const text =
      changed.length === 0
        ? `${label}, ${L} against ${E}: none of the ${rows.length} segments moved by more than sampling error would explain.`
        : `${label}, ${L} against ${E}: ${changed.length} of ${rows.length} segments moved by more than sampling error would explain. ${bits.join("; ")}.`;
    findings.push({
      sourceFileId: m.later.id,
      text,
      theme: `Change: ${label}`,
      patternType: "trend",
      stats: { kind: "wave_change_proportions", earlier: E, later: L, compared: rows.length, changed: changed.length, top: changed.slice(0, 4) },
      caveats: [note(m.later, "info", INDEPENDENCE), note(m.later, "info", LIKE_FOR_LIKE), note(m.later, "info", "Many segments are compared at once, so a few will cross |z| 1.96 by chance alone.")],
    });
  }

  const matchedIds = new Set([...modelPairs, ...propPairs].flatMap((m) => [m.earlier.id, m.later.id]));
  const evidence = (files: SetFileData[]) => files.filter((f) => f.table && f.role === "evidence" && ["model_coefficients", "proportions"].includes(f.kind) && !isRobustnessPath(f.path));
  const only = [...evidence(earlier.files), ...evidence(later.files)].filter((f) => !matchedIds.has(f.id));
  if (only.length > 0) notes.push(`${only.length} model or proportion files exist in only one wave and were not compared (${only.slice(0, 3).map((f) => f.name).join(", ")}${only.length > 3 ? ", ..." : ""}).`);
  if (findings.length === 0) notes.push("No pair of model or proportion files matched between the two sets, so there is nothing to compare yet.");
  return { findings, notes };
}
