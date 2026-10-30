// No "use server" here on purpose, same reasoning as csmMetrics.ts: brandHealthActions.ts is a
// server-action module (every export there must be an async function), so these plain
// synchronous helpers live in their own ordinary module, imported by both the server actions
// and the client panel.

import type { BrandHealthDashboard, BrandHealthFindingSection, BrandHealthMapping, BrandHealthSource } from "./brandHealthActions";
import type { VariableInfo, VariableSet } from "./parseStatsFile";

/** How far a brand's score sits from the category average, banded the way Timelaps codes its own Associations screen. A fixed +/-5 point band around the average counts as "at"; wider gaps are "above"/"below". */
export type BandVerdict = "above" | "at" | "below";

export function bandVerdict(value: number | null, categoryAvg: number | null): BandVerdict {
  if (value === null || categoryAvg === null) return "at";
  if (value >= categoryAvg + 5) return "above";
  if (value <= categoryAvg - 5) return "below";
  return "at";
}

export function bandColors(verdict: BandVerdict): { bg: string; fg: string } {
  if (verdict === "above") return { bg: "#dcfce7", fg: "#166534" };
  if (verdict === "below") return { bg: "#fef3c7", fg: "#92400e" };
  return { bg: "#f8fafc", fg: "#334155" };
}

/** The category average across every brand's score for one variable, the baseline the fingerprint and funnel gap readings are banded against. Null scores are dropped, not counted as zero. */
/** The brands' average, unrounded: from each brand's unrounded score (`exact`, CT5K-F01) where the
 * score carries it, else its display value. */
export function categoryAverageExact(byBrand: { value: number | null; exact?: number | null }[]): number | null {
  const vals = byBrand.map((b) => (b.exact !== undefined ? b.exact : b.value)).filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/** The brands' average for display: categoryAverageExact rounded once to one decimal. */
export function categoryAverage(byBrand: { value: number | null; exact?: number | null }[]): number | null {
  const avg = categoryAverageExact(byBrand);
  return avg === null ? null : Math.round(avg * 10) / 10;
}

/**
 * Matches a multi-response set's per-brand member variables to the file's brand list, by looking
 * for the brand's own text inside each member's label (eg a "brand_opinion_b1" member labelled
 * "Opinion: Plat\u014d Coffee" matches the brand "Plat\u014d Coffee"). Brands are tried longest name
 * first so a short brand name ("Cafe") can't steal a member that actually belongs to a longer one
 * ("Cafe Deluxe"). A set with fewer members than the full brand list (eg an attribute battery
 * asked for only 3 of 6 brands) simply matches fewer brands - never an error. Returned in the
 * caller's brand order, not the longest-first scan order.
 */
export function matchSetMembersToBrands(
  set: VariableSet,
  byName: Map<string, VariableInfo>,
  brands: string[],
): { brand: string; variable: string }[] {
  const members = set.vars.map((name) => ({ name, label: (byName.get(name)?.label || name).toLowerCase() }));
  const used = new Set<string>();
  const matches: { brand: string; variable: string }[] = [];
  const orderedBrands = [...brands].sort((a, b) => b.length - a.length);
  for (const brand of orderedBrands) {
    const needle = brand.toLowerCase().trim();
    if (!needle) continue;
    const hit = members.find((m) => !used.has(m.name) && m.label.includes(needle));
    if (hit) {
      used.add(hit.name);
      matches.push({ brand, variable: hit.name });
    }
  }
  const order = new Map(brands.map((b, i) => [b, i]));
  matches.sort((a, b) => (order.get(a.brand) ?? 0) - (order.get(b.brand) ?? 0));
  return matches;
}

/** A stable key for the variable(s) a section's finding is about, mirroring csmFindingKey. Null when the section has nothing to post yet. */
export function brandHealthFindingKey(dashboard: BrandHealthDashboard, section: BrandHealthFindingSection): string | null {
  if (section === "funnel") return dashboard.funnel.length ? dashboard.funnel.map((f) => f.variable).join("|") : null;
  if (section === "attributes") return dashboard.attributes.length ? dashboard.attributes.map((a) => a.variable).sort().join("|") : null;
  if (section === "loyalty") return dashboard.loyalty?.variable ?? null;
  if (section === "moments") return dashboard.moments.length ? dashboard.moments.map((m) => m.variable).sort().join("|") : null;
  return dashboard.positioning ? `${dashboard.positioning.xVariable}|${dashboard.positioning.yVariable}` : null;
}

/** One brand of a brand set: the member variable is the brand's identity; `brand` is its label, for display and
 * for matching other per-brand sets by label text (matchSetMembersToBrands). */
export type BrandSetMember = { variable: string; brand: string };

/**
 * The brands of a multiple-response set named as the brand source (Grant, 29 October 2026: "make Brand variable
 * accept a set such as owner_b"). Each member is one brand. Its label is the member's label with the variable's
 * own name prefix ("owner_b01. ") removed and then the words every member shares at the start and at the end
 * ("Current household ownership ...") removed, so "Current household ownership Toyota" gives "Toyota". At least
 * one word is always kept. Refused, with the reason, when the set is not in this file, is not a
 * multiple-response set (a battery or grid is one question per item, not one yes/no column per brand), has fewer
 * than two members, or two members end up with the same brand label (labels must tell the brands apart, because
 * the dashboard and other per-brand sets are matched to brands by label).
 */
export function brandSetMembers(
  dict: { variables: VariableInfo[]; sets?: VariableSet[] },
  setKey: string,
): { ok: true; set: VariableSet; members: BrandSetMember[] } | { ok: false; error: string } {
  const set = dict.sets?.find((s) => s.key === setKey);
  if (!set) return { ok: false, error: `The brand set "${setKey}" was not found in this file.` };
  const byName = new Map(dict.variables.map((v) => [v.name, v]));
  // A dictionary written before set kinds existed has no kind: such a set is accepted only when every member is
  // a yes/no flag, which is what a multiple-response set is. Anything else is refused, never assumed.
  const multiple = set.kind === "multi" || (set.kind === undefined && set.vars.every((name) => byName.get(name)?.isFlag === true));
  if (!multiple) {
    return { ok: false, error: `"${set.label || set.key}" is not a multiple-response set (one yes/no column per brand), so it cannot be the brand source.` };
  }
  if (set.vars.length < 2) return { ok: false, error: `"${set.label || set.key}" has fewer than two members, so it cannot list brands.` };
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const words = set.vars.map((name) => {
    const raw = (byName.get(name)?.label || name).trim();
    const own = raw.replace(new RegExp(`^${escape(name)}\\s*[.:]\\s*`, "i"), "").trim() || name;
    return own.split(/\s+/);
  });
  let lead = 0;
  while (words.every((w) => w.length > lead + 1 && w[lead].toLowerCase() === words[0][lead].toLowerCase())) lead++;
  let trail = 0;
  while (
    words.every((w) => w.length > lead + trail + 1 && w[w.length - 1 - trail].toLowerCase() === words[0][words[0].length - 1 - trail].toLowerCase())
  )
    trail++;
  const members = set.vars.map((variable, i) => ({ variable, brand: words[i].slice(lead, words[i].length - trail).join(" ") }));
  const seen = new Map<string, string>();
  for (const m of members) {
    const k = m.brand.toLowerCase();
    if (seen.has(k)) {
      return { ok: false, error: `Two members of "${set.label || set.key}" (${seen.get(k)} and ${m.variable}) have the same brand label "${m.brand}", so the brands cannot be told apart.` };
    }
    seen.set(k, m.variable);
  }
  return { ok: true, set, members };
}

/** The sentence the dashboard and a posted finding carry when the brand groups come from a multiple-response set. */
export function brandGroupsOverlapNote(setLabel: string): string {
  return `Brands come from a multiple-response question (${setLabel}): a respondent in more than one brand's group is counted in each, so groups overlap and do not sum to the total.`;
}

const METRIC_VALUES = new Set(["mean", "top1", "top2", "top3"]);

/**
 * A Brand Health mapping as saved or sent, checked field by field. A mapping saved before brand sets existed has
 * no `brandSet` and reads as one with a brand variable, unchanged. Naming both a brand variable and a brand set,
 * or a field of the wrong type, is refused with the reason: an unreadable mapping is never replaced by an empty one.
 * Whether the named set exists in the file is checked against the file's dictionary by the server actions.
 */
export function normaliseBrandHealthMapping(raw: unknown): { ok: true; mapping: BrandHealthMapping } | { ok: false; error: string } {
  const bad = (what: string) => ({ ok: false as const, error: `The saved Brand Health mapping could not be read: ${what}.` });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad("it is not an object");
  const m = raw as Record<string, unknown>;
  const optionalName = (v: unknown): v is string | null | undefined => v === undefined || v === null || (typeof v === "string" && v.length > 0);
  if (!optionalName(m.brandVar)) return bad("the brand variable is not a variable name");
  if (!optionalName(m.brandSet)) return bad("the brand set is not a set name");
  if (!optionalName(m.ourBrand)) return bad("our brand is not a brand");
  if (!optionalName(m.loyaltyVar)) return bad("the loyalty variable is not a variable name");
  const brandVar = (m.brandVar as string | null | undefined) ?? null;
  const brandSet = (m.brandSet as string | null | undefined) ?? null;
  if (brandVar && brandSet) return bad("it names both a brand variable and a brand set; exactly one may be named");
  const source = (s: unknown): s is BrandHealthSource => {
    if (!s || typeof s !== "object") return false;
    const o = s as Record<string, unknown>;
    if (o.metric !== undefined && !METRIC_VALUES.has(o.metric as string)) return false;
    return ("variable" in o && typeof o.variable === "string" && !("setKey" in o)) || ("setKey" in o && typeof o.setKey === "string" && !("variable" in o));
  };
  const funnel = (m.funnel ?? {}) as Record<string, unknown>;
  if (typeof funnel !== "object" || Array.isArray(funnel)) return bad("the funnel is not a list of stages");
  for (const [k, v] of Object.entries(funnel)) {
    if (!["awareness", "consideration", "usage", "frequent"].includes(k)) return bad(`"${k}" is not a funnel stage`);
    if (v !== undefined && v !== null && !source(v)) return bad(`the ${k} stage is not a variable or a set`);
  }
  // A list absent from the saved record means nothing was mapped there (every saved mapping has carried these
  // lists since the module was added); a list of the wrong shape is refused.
  for (const k of ["attributes", "moments"] as const) {
    if (m[k] !== undefined && (!Array.isArray(m[k]) || !(m[k] as unknown[]).every(source))) return bad(`the ${k} are not variables or sets`);
  }
  const pos = (m.positioning ?? { xVar: null, yVar: null }) as Record<string, unknown>;
  if (!optionalName(pos.xVar) || !optionalName(pos.yVar)) return bad("the positioning axes are not variable names");
  return {
    ok: true,
    mapping: {
      brandVar,
      brandSet,
      ourBrand: (m.ourBrand as string | null | undefined) ?? null,
      funnel: Object.fromEntries(Object.entries(funnel).filter(([, v]) => v)) as BrandHealthMapping["funnel"],
      attributes: (m.attributes as BrandHealthSource[] | undefined) ?? [],
      loyaltyVar: (m.loyaltyVar as string | null | undefined) ?? null,
      moments: (m.moments as BrandHealthSource[] | undefined) ?? [],
      positioning: { xVar: (pos.xVar as string | null | undefined) ?? null, yVar: (pos.yVar as string | null | undefined) ?? null },
    },
  };
}

/**
 * Whether a dashboard section shows a figure split by brand groups (one question read within each brand's group),
 * so that, with a brand set as the brand source, its brand groups overlap and the section carries the overlap
 * note. Loyalty is always such a split; a funnel, attribute or moment score only when it was not read from
 * per-brand columns.
 */
export function sectionSplitsByBrandGroups(dashboard: BrandHealthDashboard, section: BrandHealthFindingSection): boolean {
  if (section === "loyalty") return !!dashboard.loyalty;
  if (section === "positioning") return dashboard.positioning?.brandSplit === "brand_groups";
  const scores = section === "funnel" ? dashboard.funnel : section === "attributes" ? dashboard.attributes : dashboard.moments;
  return scores.some((s) => s.brandSplit === "brand_groups");
}
