// No "use server" here on purpose, same reasoning as csmMetrics.ts: brandHealthActions.ts is a
// server-action module (every export there must be an async function), so these plain
// synchronous helpers live in their own ordinary module, imported by both the server actions
// and the client panel.

import type { BrandHealthDashboard, BrandHealthFindingSection } from "./brandHealthActions";
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
