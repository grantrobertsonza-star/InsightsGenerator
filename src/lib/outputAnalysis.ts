// Set-level checks and finding drafts for a set of statistical output files.
// Pure: it takes tables and text already read from the files, and returns
// checks, caveats and draft findings. No database, no model.
//
// Wording rule: a finding describes what the output shows (an association,
// a difference between estimates) and never says more than the statistics
// support. Every caveat comes from a file in the set or from the arithmetic
// of the tables themselves.

import type { ItemLike } from "./instrumentMatch";
import type { OutputKind, OutputRole } from "./outputClassify";
import { matchGroupToItem } from "./outputQuestionnaire";

export type Table = { headers: string[]; rows: string[][] };

export type SetFileData = {
  id: string;
  name: string;
  path: string;
  family: string;
  role: OutputRole;
  kind: OutputKind;
  table: Table | null;
  text: string | null;
};

export type CaveatSeverity = "issue" | "caution" | "info" | "pass";

export type Caveat = {
  severity: CaveatSeverity;
  text: string;
  fileId: string;
  fileName: string;
  /** null means the whole set. */
  modelNumber: number | null;
  modelId: string | null;
};

export type SetCheck = {
  id: string;
  title: string;
  status: "pass" | "flag" | "info";
  detail: string;
  fileNames: string[];
};

export type DraftPattern = "model_association" | "cluster_profile" | "segment_proportions" | "trend";

export type DraftFinding = {
  sourceFileId: string;
  text: string;
  theme: string;
  patternType: DraftPattern;
  stats: Record<string, unknown>;
  caveats: Caveat[];
};

export type SetAnalysis = {
  checks: SetCheck[];
  caveats: Caveat[];
  findings: DraftFinding[];
  /** Evidence files no reader handled, so the person knows they were not turned into findings. */
  unread: { fileId: string; fileName: string; reason: string }[];
  references: { variable: string; level: string; label: string | null }[];
};

// --- Small helpers -----------------------------------------------------------

export const nk = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function num(s: string | undefined | null): number | null {
  if (s == null) return null;
  const t = s.trim();
  if (t === "" || /^(na|nan|n\/a|null|-?inf)$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function truth(s: string | undefined | null): boolean | null {
  const t = (s ?? "").trim().toLowerCase();
  if (["true", "t", "yes", "pass", "passed", "ok"].includes(t)) return true;
  if (["false", "f", "no", "fail", "failed"].includes(t)) return false;
  return null;
}

export function colIndex(t: Table, ...patterns: RegExp[]): number {
  const h = t.headers.map(nk);
  for (const p of patterns) {
    const i = h.findIndex((x) => p.test(x));
    if (i >= 0) return i;
  }
  return -1;
}

export const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");

export const fmt = (n: number, dp = 2) => n.toFixed(dp);
const fmtP = (p: number) => (p < 0.001 ? "p < .001" : `p = ${p.toFixed(3).replace(/^0/, "")}`);
export const fmtOr = (n: number) => (n < 0.01 ? "<0.01" : n >= 1000 ? n.toExponential(1).replace("e+", "e") : n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));

/** An odds ratio that is extreme with a very wide interval usually reflects very few cases in a cell. */
const unstableOr = (o: number | null, lo: number | null, hi: number | null) =>
  o !== null && (o > 1000 || o < 0.001 || (lo !== null && hi !== null && lo > 0 && hi / lo > 30));

export const isRobustnessPath = (p: string) => p.split("/").slice(0, -1).some((seg) => /robust|sensitiv|alternativ|validation|audit|replicat/i.test(seg));
export const isThreshold = (t: string) => /^\d+\s*\|\s*\d+$/.test(t.trim());

/** The first model number in a label such as "Model 2 (+ structural)" or "DV1_Model3". */
export function modelNumberOf(s: string): number | null {
  const m = /model[\s_]*(\d+)/i.exec(s);
  return m ? Number(m[1]) : null;
}

// --- Reading tables ------------------------------------------------------------

export type CoefRow = {
  term: string;
  estimate: number | null;
  se: number | null;
  stat: number | null;
  p: number | null;
  or: number | null;
  orLo: number | null;
  orHi: number | null;
  model: string | null;
  outcome: string | null;
};

export const isIntercept = (t: string) => /^\(?intercept\)?$/i.test(t.trim());

export function readCoefRows(t: Table): CoefRow[] {
  let term = colIndex(t, /^term$/, /^interaction term$/, /^variable$/, /^parameter$/, /^coefficient name$/);
  if (term < 0) {
    term = t.headers.findIndex((_, c) => t.rows.length > 0 && t.rows.every((r) => cell(r, c) !== "" && num(r[c]) === null));
  }
  const est = colIndex(t, /^estimate$/, /^coef(ficient)?$/, /^beta$/, /^b$/);
  const se = colIndex(t, /std error/, /^se$/, /^std err/, /standard error/);
  const stat = colIndex(t, /^t value$/, /^z value$/, /^statistic$/, /^t$/, /^z$/, /wald/);
  const p = colIndex(t, /^pr\b/, /^p value/, /^p$/, /^p val/);
  const or = colIndex(t, /^odds ratio$/, /^or$/);
  const lo = colIndex(t, /^or conf low/, /^or ci low/, /^or lower/, /^2 5$/, /^ci low/, /^ci l$/, /conf low/, /^lower/);
  const hi = colIndex(t, /^or conf high/, /^or ci high/, /^or upper/, /^97 5$/, /^ci high/, /^ci u$/, /conf high/, /^upper/);
  const model = colIndex(t, /^model id$/, /^model$/);
  const outcome = colIndex(t, /^outcome$/, /^dv$/);
  if (term < 0) return [];
  return t.rows.map((r) => ({
    term: cell(r, term),
    estimate: est >= 0 ? num(r[est]) : null,
    se: se >= 0 ? num(r[se]) : null,
    stat: stat >= 0 ? num(r[stat]) : null,
    p: p >= 0 ? num(r[p]) : null,
    or: or >= 0 ? num(r[or]) : null,
    orLo: lo >= 0 ? num(r[lo]) : null,
    orHi: hi >= 0 ? num(r[hi]) : null,
    model: model >= 0 ? cell(r, model) || null : null,
    outcome: outcome >= 0 ? cell(r, outcome) || null : null,
  }));
}

/** A file stem reduced to what two files of the same model share. */
export function stemKey(name: string): string {
  return nk(name.replace(/\.[^.]+$/, ""))
    .split(" ")
    .filter((w) => !/^(coefficients?|coefs?|ors?|odds|ratios?|estimates?|table|tables)$/.test(w))
    .join(" ");
}

// --- Console log: reference categories ----------------------------------------------

export function readReferences(text: string): { variable: string; level: string; label: string | null }[] {
  const clean = text.replace(/^\s*[>+]\s?/gm, " ");
  const labels = new Map<string, string>();
  for (const m of clean.matchAll(/([A-Za-z0-9_.]+)\s*=\s*clean_levels\(\s*[^,()]+,\s*"([^"]+)"\s*\)/g)) labels.set(m[1], m[2]);
  const out = new Map<string, { variable: string; level: string; label: string | null }>();
  for (const m of clean.matchAll(/relevel\(\s*([^,()]+?)\s*,\s*(?:ref\s*=\s*)?"([^"]+)"/g)) {
    const variable = (m[1].split("$").pop() ?? m[1]).replace(/\[.*$/, "").trim();
    if (!/^[A-Za-z0-9_.]+$/.test(variable) || out.has(variable)) continue;
    const level = m[2].includes(": ") ? m[2].slice(m[2].indexOf(": ") + 2) : m[2];
    out.set(variable, { variable, level, label: labels.get(variable) ?? null });
  }
  return [...out.values()];
}

const wordsOf = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

/** Matches a term group label (for example "Structural (DV6)") to a releveled variable. */
function referenceForGroup(group: string, refs: ReturnType<typeof readReferences>): { level: string } | null {
  const exact = refs.find((r) => r.label && nk(r.label) === nk(group));
  if (exact) return { level: exact.level };
  const gw = wordsOf(group);
  let best: { level: string; score: number } | null = null;
  let tie = false;
  for (const r of refs) {
    const rw = wordsOf(r.variable.replace(/([a-z])(\d)/gi, "$1_$2"));
    let score = 0;
    for (const a of gw) {
      for (const b of rw) {
        if (a === b) score += 2;
        else if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) score += 1;
      }
    }
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { level: r.level, score };
      tie = false;
    } else if (score === best.score) tie = true;
  }
  return best && !tie ? { level: best.level } : null;
}

export function splitTerm(term: string): { group: string | null; level: string } {
  const i = term.indexOf(": ");
  return i > 0 ? { group: term.slice(0, i), level: term.slice(i + 2) } : { group: null, level: term };
}

// --- Assurance ------------------------------------------------------------------------

const GVIF_CAUTION = 2.24; // sqrt(5), a common rule of thumb for adjusted GVIF
const GVIF_HIGH = 3.16; // sqrt(10)

function caveat(f: SetFileData, severity: CaveatSeverity, text: string, scope: { n?: number | null; id?: string | null } = {}): Caveat {
  return { severity, text, fileId: f.id, fileName: f.name, modelNumber: scope.n ?? null, modelId: scope.id ?? null };
}

function assuranceFrom(f: SetFileData): { caveats: Caveat[]; checks: SetCheck[] } {
  const caveats: Caveat[] = [];
  const checks: SetCheck[] = [];
  const t = f.table;
  if (!t || t.rows.length === 0) return { caveats, checks };
  const scopeCol = colIndex(t, /^model id$/, /^model$/, /^model group$/, /^outcome$/);
  const idCol = colIndex(t, /^model id$/);
  const scopeOf = (r: string[]) => {
    const raw = cell(r, scopeCol >= 0 ? scopeCol : -1);
    return { n: raw ? modelNumberOf(raw) : null, id: idCol >= 0 ? cell(r, idCol) || null : null, raw };
  };

  // Pass or fail columns (replication checks and similar).
  const passed = colIndex(t, /^passed$/, /^pass$/, /^ok$/);
  if (passed >= 0) {
    const vals = t.rows.map((r) => truth(r[passed]));
    const known = vals.filter((v) => v !== null);
    if (known.length > 0) {
      const failed = known.filter((v) => v === false).length;
      const termCol = colIndex(t, /^term$/, /^check$/, /^name$/);
      checks.push({
        id: `pass-${f.id}`,
        title: failed === 0 ? "Published results reproduce" : "A reproduction check failed",
        status: failed === 0 ? "pass" : "flag",
        detail:
          failed === 0
            ? `All ${known.length} checks in ${f.name} passed.`
            : `${failed} of ${known.length} checks in ${f.name} failed${termCol >= 0 ? `, for example ${cell(t.rows[vals.findIndex((v) => v === false)], termCol)}` : ""}.`,
        fileNames: [f.name],
      });
      if (failed > 0) caveats.push(caveat(f, "issue", `A reproduction check failed (${failed} of ${known.length} in ${f.name}). Results may not match the published figures.`));
    }
  }

  // Separation flags.
  const sep = colIndex(t, /separation flag/, /quasi.*flag/, /^separation$/);
  if (sep >= 0) {
    let flagged = 0;
    t.rows.forEach((r) => {
      const v = cell(r, sep);
      if (v && !/^(no|none|ok|false|no obvious flag|no flag)$/.test(nk(v))) {
        flagged++;
        const s = scopeOf(r);
        caveats.push(caveat(f, "issue", `Possible separation flagged (${v}). Large coefficients or standard errors may be unreliable.`, s));
      } else if (v && scopeCol >= 0) {
        const s = scopeOf(r);
        if (s.n !== null || s.id) caveats.push(caveat(f, "pass", "No separation flagged.", s));
      }
    });
    checks.push({
      id: `sep-${f.id}`,
      title: "Separation",
      status: flagged === 0 ? "pass" : "flag",
      detail: flagged === 0 ? `No model flagged in ${f.name}.` : `${flagged} of ${t.rows.length} models flagged in ${f.name}.`,
      fileNames: [f.name],
    });
  }

  // Free text warnings.
  const warn = colIndex(t, /^warnings?$/);
  if (warn >= 0) {
    let n = 0;
    t.rows.forEach((r) => {
      const v = cell(r, warn);
      if (v && !/^(none|na|ok)$/i.test(v)) {
        n++;
        caveats.push(caveat(f, "caution", `Warning from the analysis script: ${v.slice(0, 160)}`, scopeOf(r)));
      }
    });
    if (n > 0) {
      checks.push({ id: `warn-${f.id}`, title: "Script warnings", status: "flag", detail: `${n} models carry a warning in ${f.name}.`, fileNames: [f.name] });
    }
  }

  // Fitted probabilities at the extremes.
  const lowFit = colIndex(t, /fitted below/);
  const highFit = colIndex(t, /fitted above/);
  if (lowFit >= 0 || highFit >= 0) {
    t.rows.forEach((r) => {
      const n = (num(r[lowFit]) ?? 0) + (num(r[highFit]) ?? 0);
      if (n > 0) caveats.push(caveat(f, "caution", `${n} fitted probabilities sit at the extremes (below 0.0001 or above 0.9999).`, scopeOf(r)));
    });
  }

  // Collinearity.
  const gvifCols = t.headers.map((h, i) => ({ h: nk(h), i })).filter((x) => /gvif/.test(x.h));
  const maxGv = gvifCols.find((x) => /max/.test(x.h));
  if (maxGv) {
    const nameCol = colIndex(t, /^model$/, /^model id$/);
    let worst = 0;
    t.rows.forEach((r) => {
      const v = num(r[maxGv.i]);
      if (v === null) return;
      worst = Math.max(worst, v);
      const raw = cell(r, nameCol);
      const s = { n: raw ? modelNumberOf(raw) : null, id: null as string | null };
      if (v >= GVIF_HIGH) caveats.push(caveat(f, "issue", `Collinearity is high (largest adjusted GVIF ${fmt(v)}, rule-of-thumb limit about ${fmt(GVIF_HIGH)}). Individual terms may be hard to separate.`, s));
      else if (v >= GVIF_CAUTION) caveats.push(caveat(f, "caution", `Collinearity may matter (largest adjusted GVIF ${fmt(v)}; values above about ${fmt(GVIF_CAUTION)} deserve a look).`, s));
      else caveats.push(caveat(f, "pass", `Collinearity within usual limits (largest adjusted GVIF ${fmt(v)}).`, s));
    });
    checks.push({
      id: `gvif-${f.id}`,
      title: "Collinearity",
      status: worst >= GVIF_CAUTION ? "flag" : "pass",
      detail: `Largest adjusted GVIF in ${f.name}: ${fmt(worst)} (rule-of-thumb concern from about ${fmt(GVIF_CAUTION)}).`,
      fileNames: [f.name],
    });
  }

  // Design effect.
  const deff = colIndex(t, /^deff$/, /design effect/);
  if (deff >= 0) {
    const outCol = colIndex(t, /^outcome$/, /^variable$/);
    t.rows.forEach((r) => {
      const d = num(r[deff]);
      if (d === null || d <= 0) return;
      const what = cell(r, outCol);
      caveats.push(
        caveat(
          f,
          d >= 1.5 ? "caution" : "info",
          `Design effect ${fmt(d)}${what ? ` for ${what}` : ""}: the complex sample makes estimates about ${fmt(d)} times less precise in variance than a simple random sample of the same size. Standard errors should come from the survey design, as they appear to here.`,
        ),
      );
    });
    checks.push({ id: `deff-${f.id}`, title: "Design effect", status: "info", detail: `Reported in ${f.name}.`, fileNames: [f.name] });
  }

  // Small outcome cells.
  const cellCol = colIndex(t, /minimum unweighted outcome cell/);
  if (cellCol >= 0) {
    t.rows.forEach((r) => {
      const v = num(r[cellCol]);
      if (v === null) return;
      if (v < 10) caveats.push(caveat(f, "issue", `The smallest outcome cell has only ${v} unweighted cases.`, scopeOf(r)));
      else if (v < 30) caveats.push(caveat(f, "caution", `The smallest outcome cell has ${v} unweighted cases.`, scopeOf(r)));
    });
  }
  return { caveats, checks };
}

// --- Replication across alternative specifications -----------------------------------------

type Replication = { term: string; anchorOr: number | null; models: number; sameDirection: number; excludesOne: number; minOr: number | null; maxOr: number | null; fileName: string; fileId: string };

function replicationFrom(f: SetFileData): Replication[] {
  const t = f.table;
  if (!t) return [];
  const term = colIndex(t, /^term$/);
  const same = colIndex(t, /same direction/);
  const ci = colIndex(t, /excludes 1/);
  const or = colIndex(t, /^odds ratio$/);
  if (term < 0 || same < 0) return [];
  const grp = colIndex(t, /^model group$/);
  const byTerm = new Map<string, Replication>();
  for (const r of t.rows) {
    const k = cell(r, term);
    if (!k) continue;
    const cur = byTerm.get(k) ?? { term: k, anchorOr: null, models: 0, sameDirection: 0, excludesOne: 0, minOr: null, maxOr: null, fileName: f.name, fileId: f.id };
    const o0 = or >= 0 ? num(r[or]) : null;
    if (o0 !== null && cur.anchorOr === null && (grp < 0 || /^replication$/i.test(cell(r, grp)))) cur.anchorOr = o0;
    const sv = truth(r[same]);
    if (sv === null) {
      byTerm.set(k, cur);
      continue;
    }
    cur.models++;
    if (sv === true) cur.sameDirection++;
    if (ci >= 0 && truth(r[ci]) === true) cur.excludesOne++;
    const o = or >= 0 ? num(r[or]) : null;
    if (o !== null) {
      cur.minOr = cur.minOr === null ? o : Math.min(cur.minOr, o);
      cur.maxOr = cur.maxOr === null ? o : Math.max(cur.maxOr, o);
    }
    byTerm.set(k, cur);
  }
  return [...byTerm.values()];
}

// --- Consistency between coefficients and odds ratios ------------------------------------------

function pairFiles(files: SetFileData[]) {
  const coefs = files.filter((f) => f.kind === "model_coefficients" && f.table);
  const ors = files.filter((f) => f.kind === "odds_ratios" && f.table);
  const pairs: { coef: SetFileData; or: SetFileData | null }[] = [];
  const used = new Set<string>();
  for (const c of coefs) {
    const rows = readCoefRows(c.table!);
    if (rows.some((r) => r.or !== null)) {
      pairs.push({ coef: c, or: null });
      continue;
    }
    const key = stemKey(c.name);
    const match = ors.find((o) => !used.has(o.id) && o.family === c.family && stemKey(o.name) === key);
    if (match) used.add(match.id);
    pairs.push({ coef: c, or: match ?? null });
  }
  return { pairs, pairedOrIds: used };
}

function consistencyCheck(pairs: { coef: SetFileData; or: SetFileData | null }[]): SetCheck[] {
  const checks: SetCheck[] = [];
  let pairCount = 0;
  let terms = 0;
  let worstRel = 0;
  let worstTerm = "";
  let badOr = 0;
  let badCi = 0;
  let badStat = 0;
  const impliedCrit: number[] = [];
  const names: string[] = [];
  for (const { coef, or } of pairs) {
    const crows = readCoefRows(coef.table!);
    const orRows = or ? readCoefRows(or.table!) : crows;
    if (!or && !crows.some((r) => r.or !== null)) continue;
    pairCount++;
    names.push(coef.name);
    if (or) names.push(or.name);
    const byTerm = new Map(orRows.map((r) => [`${nk(r.model ?? "")}|${nk(r.term)}`, r]));
    for (const c of crows) {
      const o = byTerm.get(`${nk(c.model ?? "")}|${nk(c.term)}`);
      if (!o || o.or === null) continue;
      if (c.estimate !== null) {
        terms++;
        const exp = Math.exp(c.estimate);
        const rel = Math.abs(o.or - exp) / Math.max(exp, 1e-12);
        const abs = Math.abs(o.or - exp);
        if (rel > worstRel) {
          worstRel = rel;
          worstTerm = c.term;
        }
        if (rel > 0.005 && abs > 0.0006) badOr++;
      }
      if (c.estimate !== null && c.se && c.se > 0 && o.orLo && o.orHi && o.orLo > 0 && o.orHi > 0) {
        const crit = (Math.log(o.orHi) - Math.log(o.orLo)) / (2 * c.se);
        impliedCrit.push(crit);
        if (crit < 1.8 || crit > 2.4) badCi++;
      }
      if (c.estimate !== null && c.se && c.se > 0 && c.stat !== null && Math.abs(c.stat) > 0.05) {
        if (Math.abs(c.stat - c.estimate / c.se) / Math.abs(c.stat) > 0.01) badStat++;
      }
    }
  }
  if (pairCount === 0) return checks;
  const medianCrit = impliedCrit.length ? [...impliedCrit].sort((a, b) => a - b)[Math.floor(impliedCrit.length / 2)] : null;
  checks.push({
    id: "or-vs-coef",
    title: "Odds ratios equal exp(estimate)",
    status: badOr === 0 ? "pass" : "flag",
    detail:
      badOr === 0
        ? `${terms} terms across ${pairCount} models: every odds ratio matches exp(estimate) (largest relative difference ${(worstRel * 100).toExponential(1)}%).`
        : `${badOr} of ${terms} terms differ from exp(estimate) by more than rounding explains; the worst is "${worstTerm}" (${(worstRel * 100).toFixed(1)}%). The odds ratio file may come from another model run.`,
    fileNames: names,
  });
  checks.push({
    id: "ci-width",
    title: "Intervals fit the standard errors",
    status: badCi === 0 ? "pass" : "flag",
    detail:
      medianCrit === null
        ? "Not enough information to compare intervals with standard errors."
        : badCi === 0
          ? `The interval widths imply a critical value of about ${fmt(medianCrit)}, in line with a 95% interval.`
          : `${badCi} intervals imply a critical value outside 1.8 to 2.4 (median ${fmt(medianCrit)}). The confidence level or degrees of freedom may differ from the standard errors shown.`,
    fileNames: names,
  });
  if (badStat > 0) {
    checks.push({
      id: "stat-vs-se",
      title: "Test statistics equal estimate divided by standard error",
      status: "flag",
      detail: `${badStat} test statistics differ from estimate / standard error by more than 1%.`,
      fileNames: names,
    });
  }
  return checks;
}

// --- Finding readers ------------------------------------------------------------------------------

type Ctx = {
  items: ItemLike[];
  refs: ReturnType<typeof readReferences>;
  caveats: Caveat[];
  replication: Replication[];
};

function caveatsFor(ctx: Ctx, scope: { n: number | null; id: string | null }, extra: Caveat[] = []): Caveat[] {
  const out = ctx.caveats.filter((c) => {
    if (c.modelNumber === null && c.modelId === null) return true;
    if (scope.n !== null && c.modelNumber === scope.n) return true;
    if (scope.id !== null && c.modelId === scope.id) return true;
    return false;
  });
  return [...out, ...extra];
}

const MAX_MODELS_PER_FILE = 6;

const MULTI_NOTE = "P-values are not adjusted for the number of terms in the model, so the strongest terms are the most trustworthy ones and a single p near .05 should be read with care.";

type TermView = { text: string; row: CoefRow; or: number | null; lo: number | null; hi: number | null; referenceKnown: boolean };

function describeTerm(row: CoefRow, or: { or: number | null; lo: number | null; hi: number | null }, refs: ReturnType<typeof readReferences>): TermView {
  const { group, level } = splitTerm(row.term);
  const ref = group ? referenceForGroup(group, refs) : null;
  const label = group ? `${group}: ${level}` : level;
  const vs = ref ? ` than ${ref.level}` : "";
  const dir = or.or !== null ? (or.or >= 1 ? "higher" : "lower") : (row.estimate ?? 0) >= 0 ? "higher" : "lower";
  const stat =
    or.or !== null
      ? `OR ${fmtOr(or.or)}${or.lo !== null && or.hi !== null ? `, 95% CI ${fmtOr(or.lo)} to ${fmtOr(or.hi)}` : ""}${row.p !== null ? `, ${fmtP(row.p)}` : ""}`
      : `estimate ${fmt(row.estimate ?? 0, 3)}${row.se !== null ? ` (SE ${fmt(row.se, 3)})` : ""}${row.p !== null ? `, ${fmtP(row.p)}` : ""}`;
  const noun = or.or !== null ? "odds" : "values";
  return { text: `${label} (${dir} ${noun}${vs}; ${stat})`, row, or: or.or, lo: or.lo, hi: or.hi, referenceKnown: !!ref };
}

function modelFindings(
  pairs: { coef: SetFileData; or: SetFileData | null }[],
  ctx: Ctx,
  outcomeHint: string | null,
): DraftFinding[] {
  const out: DraftFinding[] = [];
  for (const { coef, or } of pairs) {
    const rows = readCoefRows(coef.table!);
    if (rows.length === 0) continue;
    const orRows = or ? new Map(readCoefRows(or.table!).map((r) => [`${nk(r.model ?? "")}|${nk(r.term)}`, r])) : null;
    // A long file holds several models. Group by model id; a wide file is one model.
    const groups = new Map<string, CoefRow[]>();
    for (const r of rows) groups.set(r.model ?? "", [...(groups.get(r.model ?? "") ?? []), r]);
    // A file holding many models is a robustness or sensitivity collection. It feeds the
    // robustness checks rather than producing a finding per model.
    if (groups.size > MAX_MODELS_PER_FILE) continue;
    for (const [modelId, grp] of groups) {
      const label = modelId || coef.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\b(coefficients?|coefs?)\b/i, "").trim();
      const num0 = modelNumberOf(modelId || coef.name);
      const testable = grp.filter((r) => !isIntercept(r.term) && !isThreshold(r.term) && r.p !== null && r.estimate !== null);
      if (testable.length === 0) continue;
      const orFor = (r: CoefRow) => {
        const o = orRows?.get(`${nk(r.model ?? "")}|${nk(r.term)}`);
        return { or: r.or ?? o?.or ?? null, lo: r.orLo ?? o?.orLo ?? null, hi: r.orHi ?? o?.orHi ?? null };
      };
      const sig = testable.filter((r) => (r.p as number) < 0.05);
      const unstable = sig.filter((r) => {
        const o = orFor(r);
        return unstableOr(o.or, o.lo, o.hi);
      });
      const rank0 = sig.filter((r) => !unstable.includes(r));
      const rank = [...rank0].sort((a, b) => Math.abs(b.stat ?? (b.estimate as number) / (b.se || 1)) - Math.abs(a.stat ?? (a.estimate as number) / (a.se || 1)));
      const top = rank.slice(0, 4).map((r) => describeTerm(r, orFor(r), ctx.refs));
      const outcome = grp[0].outcome ?? outcomeHint;
      const head = `${label || "Model"}${outcome ? ` (outcome ${outcome})` : ""}`;
      let text: string;
      if (top.length === 0) {
        text = `${head}: none of the ${testable.length} terms reached p < .05, so the model gives little evidence that any of them is associated with the outcome after adjustment.`;
      } else {
        const lead = `${head}: ${sig.length} of ${testable.length} terms were statistically significant at p < .05. The clearest associations were `;
        text = lead + top.map((t) => t.text).join("; ") + ".";
      }
      const extra: Caveat[] = [caveat(coef, "info", MULTI_NOTE, { n: num0, id: modelId || null })];
      if (unstable.length > 0) extra.push(caveat(coef, "caution", `${unstable.length} significant terms were left out of the summary because their odds ratios are extreme with very wide intervals, which usually means very few cases in those groups.`, { n: num0, id: modelId || null }));
      const unknownRef = top.some((t) => !t.referenceKnown && splitTerm(t.row.term).group);
      if (unknownRef) extra.push(caveat(coef, "info", "The reference category for some of these terms is not stated in the files. Odds ratios compare each level with the omitted level of its variable.", { n: num0, id: modelId || null }));
      // Possible questionnaire wording for each term group.
      const seenGroups = new Set<string>();
      for (const t of top) {
        const g = splitTerm(t.row.term).group;
        if (!g || seenGroups.has(g) || ctx.items.length === 0) continue;
        seenGroups.add(g);
        const m = matchGroupToItem(g, ctx.items);
        if (m) extra.push(caveat(coef, "info", `Possible questionnaire item for "${g}": ${m.code ? `${m.code}, ` : ""}"${m.text.slice(0, 160)}${m.text.length > 160 ? "..." : ""}" (a ${m.confidence}-confidence suggestion, worth checking).`, { n: num0, id: modelId || null }));
      }
      // Replication evidence for the headline terms.
      for (const t of top) {
        const rep = ctx.replication.find(
          (x) =>
            x.models >= 3 &&
            (nk(x.term) === nk(t.row.term) ||
              (t.or !== null && x.anchorOr !== null && Math.abs(t.or - x.anchorOr) / x.anchorOr < 0.002 && (t.row.estimate ?? 0) * Math.log(x.anchorOr) > 0)),
        );
        if (rep) {
          extra.push(
            caveat(
              coef,
              rep.sameDirection === rep.models && rep.excludesOne === rep.models ? "pass" : "caution",
              `${splitTerm(t.row.term).level}: in ${rep.models} alternative specifications, ${rep.sameDirection} kept the direction and ${rep.excludesOne} had an interval excluding 1${rep.minOr !== null && rep.maxOr !== null ? ` (odds ratio ${fmtOr(rep.minOr)} to ${fmtOr(rep.maxOr)})` : ""}.`,
              { n: num0, id: modelId || null },
            ),
          );
        }
      }
      out.push({
        sourceFileId: coef.id,
        text,
        theme: `Model: ${label || coef.name}`,
        patternType: "model_association",
        stats: {
          kind: "model_association",
          model: label,
          termsTested: testable.length,
          termsSignificant: sig.length,
          headline: top.map((t) => ({ term: t.row.term, or: t.or, lo: t.lo, hi: t.hi, estimate: t.row.estimate, se: t.row.se, p: t.row.p })),
        },
        caveats: caveatsFor(ctx, { n: num0, id: modelId || null }, extra),
      });
    }
  }
  return out;
}

/** Odds ratio tables without coefficients (for example interaction terms), one finding per block. */
function orTableFindings(files: SetFileData[], ctx: Ctx): DraftFinding[] {
  const out: DraftFinding[] = [];
  for (const f of files) {
    const t = f.table!;
    const rows = readCoefRows(t);
    if (rows.length === 0 || rows.some((r) => r.estimate !== null)) continue;
    const blockCol = colIndex(t, /^block$/, /^group$/, /^family$/);
    const groups = new Map<string, { row: CoefRow }[]>();
    rows.forEach((r, i) => {
      const k = blockCol >= 0 ? cell(t.rows[i], blockCol) : "";
      groups.set(k, [...(groups.get(k) ?? []), { row: r }]);
    });
    for (const [block, g] of groups) {
      const testable = g.filter((x) => x.row.or !== null && x.row.p !== null);
      if (testable.length === 0) continue;
      const sig = testable.filter((x) => (x.row.p as number) < 0.05);
      const name = block || f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
      let text: string;
      if (sig.length === 0) {
        const strongest = [...testable].sort((a, b) => (a.row.p as number) - (b.row.p as number))[0].row;
        text = `${name}: none of the ${testable.length} terms reached p < .05. The smallest was ${fmtP(strongest.p as number)} for ${strongest.term} (OR ${fmtOr(strongest.or as number)}). This gives little evidence of a difference, although a non-significant interaction does not show that the groups behave alike.`;
      } else {
        const stable = sig.filter((x) => !unstableOr(x.row.or, x.row.orLo, x.row.orHi));
        const v = (stable.length > 0 ? stable : sig).slice(0, 4).map((x) => `${x.row.term} (OR ${fmtOr(x.row.or as number)}${x.row.orLo !== null && x.row.orHi !== null ? `, 95% CI ${fmtOr(x.row.orLo)} to ${fmtOr(x.row.orHi)}` : ""}, ${fmtP(x.row.p as number)})`);
        text = `${name}: ${sig.length} of ${testable.length} terms reached p < .05: ${v.join("; ")}.${stable.length < sig.length ? ` ${sig.length - stable.length} further terms had extreme odds ratios with very wide intervals and are not summarised.` : ""}`;
      }
      out.push({
        sourceFileId: f.id,
        text,
        theme: `Model: ${name}`,
        patternType: "model_association",
        stats: { kind: "or_table", block: name, termsTested: testable.length, termsSignificant: sig.length },
        caveats: caveatsFor(ctx, { n: null, id: null }, [
          caveat(f, "info", MULTI_NOTE),
          ...(sig.some((x) => unstableOr(x.row.or, x.row.orLo, x.row.orHi)) ? [caveat(f, "caution", "Some odds ratios in this table are extreme with very wide intervals, which usually means very few cases in those cells. Read them as unstable.")] : []),
        ]),
      });
    }
  }
  return out;
}

/** Proportions with intervals: one finding per segment variable whose extreme levels have separate intervals. */
function proportionFindings(files: SetFileData[], ctx: Ctx): DraftFinding[] {
  const out: DraftFinding[] = [];
  for (const f of files) {
    const t = f.table!;
    const seg = colIndex(t, /^segment var/, /^variable$/, /^segment$/);
    const lvl = colIndex(t, /^segment level/, /^level$/, /^category$/);
    const val = colIndex(t, /^prop/, /^percent/, /^pct/, /^share$/, /^estimate$/);
    const lo = colIndex(t, /ci l\b/, /ci low/, /conf low/, /lower/);
    const hi = colIndex(t, /ci u\b/, /ci high/, /conf high/, /upper/);
    const outcome = colIndex(t, /^outcome$/);
    if (seg < 0 || lvl < 0 || val < 0 || lo < 0 || hi < 0) continue;
    const bySeg = new Map<string, { level: string; v: number; lo: number; hi: number; outcome: string }[]>();
    for (const r of t.rows) {
      const v = num(r[val]);
      const l = num(r[lo]);
      const h = num(r[hi]);
      if (v === null || l === null || h === null || h - l < 0.05) continue;
      const k = cell(r, seg);
      bySeg.set(k, [...(bySeg.get(k) ?? []), { level: cell(r, lvl), v, lo: l, hi: h, outcome: cell(r, outcome) }]);
    }
    const unit = /pct|percent/.test(nk(t.headers[val])) ? "%" : "";
    const made: DraftFinding[] = [];
    for (const [segName, levels] of bySeg) {
      if (levels.length < 2) continue;
      const hiL = levels.reduce((a, b) => (b.v > a.v ? b : a));
      const loL = levels.reduce((a, b) => (b.v < a.v ? b : a));
      if (hiL === loL || hiL.lo <= loL.hi) continue; // intervals overlap, nothing to say
      const what = hiL.outcome || "the measure";
      const spill = [hiL, loL].some((x) => x.hi > 100 || x.lo < 0);
      made.push({
        sourceFileId: f.id,
        text: `${what.replace(/_/g, " ")} by ${segName.replace(/_/g, " ")}: ${hiL.level} was highest at ${fmt(hiL.v, 1)}${unit} (95% CI ${fmt(hiL.lo, 1)} to ${fmt(hiL.hi, 1)}) and ${loL.level} lowest at ${fmt(loL.v, 1)}${unit} (${fmt(loL.lo, 1)} to ${fmt(loL.hi, 1)}). The intervals do not overlap, which suggests a real difference between these two groups, although other groups were not compared with each other here.`,
        theme: `Segments: ${segName.replace(/_/g, " ")}`,
        patternType: "segment_proportions",
        stats: { kind: "proportion_gap", segment: segName, high: hiL, low: loL, gap: hiL.v - loL.v },
        caveats: caveatsFor(ctx, { n: null, id: null }, [
          caveat(f, "info", "Separate intervals are a conservative sign of a difference; a formal test of the gap was not part of the output. Differences between segments are associations and may reflect other characteristics (for example age or income)."),
          ...(spill ? [caveat(f, "caution", "One interval extends past 0% or 100%, which points to a normal approximation near the boundary. Treat that estimate as approximate.")] : []),
        ]),
      });
    }
    made.sort((a, b) => ((b.stats.gap as number) ?? 0) - ((a.stats.gap as number) ?? 0));
    out.push(...made.slice(0, 8));
  }
  return out;
}

/** Cluster profiles and label, value, SE tables. */
function clusterFindings(files: SetFileData[], all: SetFileData[], ctx: Ctx): DraftFinding[] {
  const out: DraftFinding[] = [];
  for (const f of files) {
    const t = f.table!;
    if (t.rows.length < 2 || t.rows.length > 15) continue;
    const labelCol = t.headers.findIndex((_, c) => t.rows.every((r) => cell(r, c) !== "" && num(r[c]) === null));
    if (labelCol < 0 || !/cluster|segment|typolog|group|profile|class|archetype/.test(nk(t.headers[labelCol]))) continue;
    if (t.headers.some((h) => /weighted (total|share|percentage)/.test(nk(h)))) continue; // size table, used as context only
    const numCols = t.headers.map((_, c) => c).filter((c) => c !== labelCol && t.rows.every((r) => num(r[c]) !== null));
    if (numCols.length === 0) continue;
    const seCol = numCols.find((c) => /^se$|std error|standard error/.test(nk(t.headers[c])));
    const valueCols = numCols.filter((c) => c !== seCol);
    const sizeFile = all.find((x) => x.id !== f.id && x.family === f.family && x.table && colIndex(x.table, /weighted percentage|weighted share/) >= 0 && /cluster/.test(nk(x.table.headers.join(" "))));
    let sizeText = "";
    if (sizeFile?.table) {
      const lc = sizeFile.table.headers.findIndex((_, c) => sizeFile.table!.rows.every((r) => cell(r, c) !== "" && num(r[c]) === null));
      const pc = colIndex(sizeFile.table, /weighted percentage/);
      if (lc >= 0 && pc >= 0) sizeText = ` Group sizes (weighted): ${sizeFile.table.rows.map((r) => `${cell(r, lc)} ${fmt(num(r[pc]) ?? 0, 1)}%`).join(", ")}.`;
    }
    if (seCol !== undefined && valueCols.length === 1) {
      const vc = valueCols[0];
      const rowsV = t.rows.map((r) => ({ label: cell(r, labelCol), v: num(r[vc]) as number, se: num(r[seCol]) as number }));
      const hiR = rowsV.reduce((a, b) => (b.v > a.v ? b : a));
      const loR = rowsV.reduce((a, b) => (b.v < a.v ? b : a));
      if (hiR === loR) continue;
      const seDiff = Math.sqrt(hiR.se ** 2 + loR.se ** 2);
      const z = seDiff > 0 ? (hiR.v - loR.v) / seDiff : null;
      const measure = nk(t.headers[vc]).replace(/ /g, " ");
      const pct = hiR.v <= 1 && loR.v >= 0;
      const show = (x: number) => (pct ? `${fmt(x * 100, 1)}%` : fmt(x, 2));
      out.push({
        sourceFileId: f.id,
        text: `${measure} by ${nk(t.headers[labelCol])}: ${hiR.label} was highest at ${show(hiR.v)} (SE ${fmt(hiR.se * (pct ? 100 : 1), 1)}${pct ? " points" : ""}) and ${loR.label} lowest at ${show(loR.v)} (SE ${fmt(loR.se * (pct ? 100 : 1), 1)}${pct ? " points" : ""}).${z !== null && Math.abs(z) > 1.96 ? ` The gap is about ${fmt(Math.abs(z), 1)} standard errors, which suggests a real difference, treating the two estimates as independent.` : " The gap is small relative to its standard error."}${sizeText}`,
        theme: `Segments: ${nk(t.headers[labelCol])}`,
        patternType: "segment_proportions",
        stats: { kind: "estimates_with_se", high: hiR, low: loR, z },
        caveats: caveatsFor(ctx, { n: null, id: null }, [caveat(f, "info", "Segment membership comes from the clustering, so differences on the variables used to build the clusters are partly built in. Treat them as a description of the segments rather than a test.")]),
      });
      continue;
    }
    if (valueCols.length < 2) continue;
    const spread = valueCols
      .map((c) => {
        const vals = t.rows.map((r) => ({ label: cell(r, labelCol), v: num(r[c]) as number }));
        const mx = vals.reduce((a, b) => (b.v > a.v ? b : a));
        const mn = vals.reduce((a, b) => (b.v < a.v ? b : a));
        const scale = Math.max(Math.abs(mx.v), Math.abs(mn.v)) || 1;
        return { name: t.headers[c], mx, mn, rel: (mx.v - mn.v) / scale };
      })
      .sort((a, b) => b.rel - a.rel);
    const top = spread.slice(0, 3).filter((s) => s.rel > 0.1);
    if (top.length === 0) continue;
    const parts = top.map((s) => `${s.name.replace(/_/g, " ")} (${s.mx.label} ${fmt(s.mx.v, 1)} against ${s.mn.label} ${fmt(s.mn.v, 1)})`);
    const silFile = all.find((x) => x.family === f.family && x.table && colIndex(x.table, /silhouette/) >= 0 && colIndex(x.table, /^k$/) >= 0);
    let silText = "";
    if (silFile?.table) {
      const kc = colIndex(silFile.table, /^k$/);
      const sc = colIndex(silFile.table, /silhouette/);
      const row = silFile.table.rows.find((r) => num(r[kc]) === t.rows.length);
      const v = row ? num(row[sc]) : null;
      if (v !== null) silText = ` The average silhouette width for ${t.rows.length} clusters was ${fmt(v, 2)}${v <= 0.25 ? ", which by the usual rule of thumb suggests little real cluster structure" : v <= 0.5 ? ", which by the usual rule of thumb suggests weak cluster structure" : ""}.`;
    }
    out.push({
      sourceFileId: f.id,
      text: `The ${t.rows.length} segments differ most on ${parts.join("; ")}.${sizeText}${silText}`,
      theme: "Segments: cluster profile",
      patternType: "cluster_profile",
      stats: { kind: "cluster_profile", clusters: t.rows.length, variables: top.map((s) => ({ name: s.name, high: s.mx, low: s.mn, relativeSpread: s.rel })) },
      caveats: caveatsFor(ctx, { n: null, id: null }, [
        caveat(f, "info", "Cluster profiles describe the solution that was fitted. No test of between-cluster differences was in the output, and differences on the clustering variables are partly built in."),
      ]),
    });
  }
  return out;
}

// --- Entry point ----------------------------------------------------------------------------------------------

export function analyseSet(files: SetFileData[], options: { items?: ItemLike[] } = {}): SetAnalysis {
  const checks: SetCheck[] = [];
  const caveats: Caveat[] = [];
  const replication: Replication[] = [];

  const consoleText = files.filter((f) => f.kind === "console_log" && f.text).map((f) => f.text as string).join("\n");
  const refs = consoleText ? readReferences(consoleText) : [];
  if (consoleText) {
    checks.push({
      id: "references",
      title: "Reference categories",
      status: refs.length > 0 ? "pass" : "info",
      detail: refs.length > 0 ? `Found ${refs.length} reference categories in the console log (${refs.slice(0, 4).map((r) => `${r.variable}: ${r.level}`).join(", ")}${refs.length > 4 ? ", ..." : ""}).` : "The console log was read but no reference categories were found.",
      fileNames: files.filter((f) => f.kind === "console_log").map((f) => f.name),
    });
  }

  for (const f of files) {
    if (f.role !== "assurance" && f.kind !== "diagnostics" && f.kind !== "validation_checks" && f.kind !== "cluster_diagnostics") continue;
    const a = assuranceFrom(f);
    checks.push(...a.checks);
    caveats.push(...a.caveats);
    replication.push(...replicationFrom(f));
  }
  // Robustness results can sit with the evidence files too.
  for (const f of files) {
    if (f.role === "assurance") continue;
    const r = replicationFrom(f);
    if (r.length > 0) replication.push(...r);
  }
  if (replication.length > 0) {
    const sets = new Map<string, Replication>();
    for (const r of replication) if (!sets.has(r.term)) sets.set(r.term, r);
    const agg = [...sets.values()];
    const worst = agg.filter((r) => r.models >= 3 && (r.sameDirection < r.models || r.excludesOne < r.models));
    checks.push({
      id: "replication",
      title: "Robustness across specifications",
      status: worst.length === 0 ? "pass" : "flag",
      detail:
        worst.length === 0
          ? `${agg.filter((r) => r.models >= 3).length} headline terms kept their direction and an interval excluding 1 in every alternative specification.`
          : `${worst.length} of ${agg.filter((r) => r.models >= 3).length} headline terms changed direction or lost precision in at least one alternative specification (for example ${worst[0].term}: ${worst[0].sameDirection} of ${worst[0].models} kept direction).`,
      fileNames: [...new Set(replication.map((r) => r.fileName))],
    });
  }

  const evidenceAll = files.filter((f) => f.table && f.role === "evidence");
  const evidence = evidenceAll.filter((f) => !isRobustnessPath(f.path));
  const robustnessOnly = evidenceAll.filter((f) => isRobustnessPath(f.path));
  const { pairs, pairedOrIds } = pairFiles(evidence);
  checks.push(...consistencyCheck(pairs));

  // Run context from the manifest or session info, shown as information only.
  const manifest = files.find((f) => f.kind === "manifest" && f.table);
  const session = files.find((f) => f.kind === "session_info" && f.text);
  const bits: string[] = [];
  if (manifest?.table) {
    const k = colIndex(manifest.table, /^item$/);
    const v = colIndex(manifest.table, /^value$/);
    if (k >= 0 && v >= 0) for (const r of manifest.table.rows) if (/^(run time|r version)$/i.test(cell(r, k).replace(/_/g, " "))) bits.push(`${cell(r, k).replace(/_/g, " ")}: ${cell(r, v)}`);
  }
  if (session?.text && bits.length === 0) bits.push(session.text.split("\n").find((l) => /^R version/i.test(l)) ?? "");
  if (bits.filter(Boolean).length > 0) {
    checks.push({ id: "context", title: "Run context", status: "info", detail: bits.filter(Boolean).join("; "), fileNames: [manifest?.name ?? session?.name ?? ""].filter(Boolean) });
  }

  const ctx: Ctx = { items: options.items ?? [], refs, caveats, replication };
  const outcomeVals = new Set<string>();
  for (const f of files) {
    if (!f.table || !/design effect|deff/.test(nk(f.name + " " + f.table.headers.join(" ")))) continue;
    const oc = colIndex(f.table, /^outcome$/);
    if (oc >= 0) f.table.rows.forEach((r) => cell(r, oc) && outcomeVals.add(cell(r, oc)));
  }
  const outcomeHint = outcomeVals.size === 1 ? [...outcomeVals][0] : null;

  const findings: DraftFinding[] = [];
  const handled = new Set<string>();
  const modelF = modelFindings(pairs, ctx, outcomeHint);
  findings.push(...modelF);
  for (const p of pairs) {
    handled.add(p.coef.id);
    if (p.or) handled.add(p.or.id);
  }
  const orOnly = evidence.filter((f) => f.kind === "odds_ratios" && !pairedOrIds.has(f.id));
  const orF = orTableFindings(orOnly, ctx);
  findings.push(...orF);
  orOnly.forEach((f) => handled.add(f.id));
  const propF = proportionFindings(evidence.filter((f) => f.kind === "proportions"), ctx);
  findings.push(...propF);
  evidence.filter((f) => f.kind === "proportions").forEach((f) => handled.add(f.id));
  const clusterFiles = evidence.filter((f) => f.kind === "cluster_profile" || f.kind === "descriptive_table");
  const clF = clusterFindings(clusterFiles, files, ctx);
  findings.push(...clF);

  const producing = new Set(findings.map((f) => f.sourceFileId));
  const seenText = new Set<string>();
  const deduped = findings.filter((f) => {
    if (seenText.has(f.text)) return false;
    seenText.add(f.text);
    return true;
  });
  findings.length = 0;
  findings.push(...deduped);
  const unread = [
    ...robustnessOnly.map((f) => ({ fileId: f.id, fileName: f.name, reason: "Robustness or sensitivity material. It feeds the robustness checks and the notes on each finding rather than giving findings of its own." })),
    ...evidence
    .filter((f) => !producing.has(f.id) && !(f.kind === "odds_ratios" && handled.has(f.id)))
    .map((f) => ({
      fileId: f.id,
      fileName: f.name,
      reason:
        f.kind === "descriptive_table" || f.kind === "word_tables"
          ? "A descriptive table with no interval or test, so it supports other findings but gives none of its own."
          : "No finding reader fits this file yet.",
    })),
  ];

  return { checks, caveats, findings, unread, references: refs };
}
