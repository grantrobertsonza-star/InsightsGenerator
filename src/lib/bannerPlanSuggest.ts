// Proposes a default banner plan for a raw, case-level table, so a researcher
// does not have to name the comparisons before anything is computed.
//
// Banner (segmenting) columns are text columns with a handful of categories,
// each large enough to compare. Stub (outcome) columns are numeric columns,
// which covers 0/1 flags and rating scales. ID-like, constant and
// free-text-like columns are left out. The plan is capped so the number of
// comparisons stays bounded, because every comparison carries the
// uncorrected-multiple-comparisons caveat. It is a starting point the
// researcher can edit and recompute, not a claim about what matters.

import { profileVariables } from "./variableProfile";

type Row = Record<string, string | number | null>;

export const MAX_AUTO_BANNERS = 3;
export const MAX_AUTO_COMPARISON_PAIRS = 45;

export type SuggestedBannerPlan = { banner: string[]; stub: string[] };

export function suggestBannerPlan(
  headers: string[],
  rows: Row[],
): SuggestedBannerPlan | null {
  if (rows.length < 30) return null;
  const profiles = profileVariables(headers, rows).filter((p) => p.missingPct <= 50);
  const banner = profiles
    .filter((p) => p.suggestedRole === "across")
    .map((p) => p.name)
    .slice(0, MAX_AUTO_BANNERS);
  const stubCandidates = profiles
    .filter((p) => p.suggestedRole === "measure")
    .map((p) => p.name);
  if (banner.length === 0 || stubCandidates.length === 0) return null;
  const maxStubs = Math.max(1, Math.floor(MAX_AUTO_COMPARISON_PAIRS / banner.length));
  return { banner, stub: stubCandidates.slice(0, maxStubs) };
}
