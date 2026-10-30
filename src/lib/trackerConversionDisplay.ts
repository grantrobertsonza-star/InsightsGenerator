// Display rules of the brand dashboard's Conversion view (page 01) that the screen runs as well as the server: the
// stage names, the ranking of brands within a step and the one-line headline for the client's brand. Pure and free
// of server imports, so the client component can use the same rules as the tests. The figures themselves come from
// trackerConversion.ts (loadBrandConversion); the contract is in claude/d2-design-2026-10-29.md, D3h.
import type { UnknownAnswerKind } from "./trackerFigures";
import type { FunnelStage } from "./trackerRoles";

export const CONVERSION_STAGE_NAME: Partial<Record<FunnelStage, string>> = {
  awareness: "Awareness",
  consideration: "Consideration",
  shortlist: "Shortlist",
  first_choice: "First choice",
  usage: "Usage",
  frequent_usage: "Frequent usage",
};
export const conversionStageName = (s: FunnelStage) => CONVERSION_STAGE_NAME[s] ?? s;
const lower = (s: FunnelStage) => conversionStageName(s).toLowerCase();

export type UnknownAnswerCount = { code: string; label: string | null; kind: UnknownAnswerKind; n: number };

export type ConversionCell = {
  code: string;
  fromVariable: string | null;
  toVariable: string | null;
  /** Unrounded percentage converting; null when not available or suppressed (see `reason`). */
  conversion: number | null;
  /** Unweighted respondents at S with a known answer to T (the base); null when it cannot be told. */
  base: number | null;
  /** Weighted counts the conversion is the ratio of (equal to the unweighted counts when unweighted). */
  weightedBase: number | null;
  weightedConverted: number | null;
  /** Unweighted respondents at S. */
  atFrom: number | null;
  /** Unweighted respondents at S and at T. */
  converted: number | null;
  /** Answers at T among those at S that are neither selected nor an explicit not selected (outside the base). */
  unknownAtTo: UnknownAnswerCount[];
  /** Respondents at S with no answer at T (blank or declared missing; outside the base). */
  noAnswerAtTo: number | null;
  /** Unweighted respondents at T who are not at S (any other answer, unknown or blank at S); null when not read. */
  nonNested: number | null;
  /** The base is under the engine's minimum, so the figure is withheld. */
  suppressed: boolean;
  reason?: string;
};

// ---- Ranking and the headline (display rules, pure) --------------------------------------------------------------

export type StepRanking = {
  /** Brands with a figure, highest unrounded conversion first, equal figures in the brand list's order. */
  ranked: { code: string; rank: number; conversion: number }[];
  /** Brands without a figure, in the brand list's order: never ranked, never 0. */
  suppressed: string[];
  notAvailable: string[];
};

/** Ranks one step's brands. Ties share no rank: the brand list's order decides, and the rank is the place. */
export function rankConversion(cells: ConversionCell[]): StepRanking {
  const withFigure = cells.map((c, i) => ({ c, i })).filter((x) => x.c.conversion !== null);
  withFigure.sort((x, y) => (y.c.conversion as number) - (x.c.conversion as number) || x.i - y.i);
  return {
    ranked: withFigure.map((x, r) => ({ code: x.c.code, rank: r + 1, conversion: x.c.conversion as number })),
    suppressed: cells.filter((c) => c.conversion === null && c.suppressed).map((c) => c.code),
    notAvailable: cells.filter((c) => c.conversion === null && !c.suppressed).map((c) => c.code),
  };
}

const ADJECTIVE: Partial<Record<FunnelStage, string>> = {
  awareness: "aware",
  consideration: "considering",
  shortlist: "shortlisting",
  first_choice: "first-choice",
  usage: "using",
};
const ordinal = (n: number) => {
  const t = n % 100;
  const s = t >= 11 && t <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${s}`;
};

/** "1 brand not ranked (small base)", "3 brands not ranked (1 small base, 2 not available)", or "". */
function notRankedText(r: StepRanking): string {
  const k = r.suppressed.length + r.notAvailable.length;
  if (k === 0) return "";
  const parts = [r.suppressed.length > 0 ? `${r.suppressed.length} small base` : "", r.notAvailable.length > 0 ? `${r.notAvailable.length} not available` : ""].filter(Boolean);
  return `${k} ${k === 1 ? "brand" : "brands"} not ranked (${parts.join(", ")})`;
}

/**
 * The one-line headline of a step for the client's brand: "BMW converts 39% of aware respondents to consideration,
 * 6th of 10 brands." Ranks count only brands with a figure, and the sentence says how many were left out. No
 * significance is claimed or implied. Without a client brand, or without its figure, it says so.
 */
export function conversionHeadline(step: { from: FunnelStage; to: FunnelStage }, cells: ConversionCell[], focal: { code: string; label: string } | null): string {
  const r = rankConversion(cells);
  const left = notRankedText(r);
  if (!focal) return `Choose your brand to see its headline.${left ? ` ${left}.` : ""}`;
  const cell = cells.find((c) => c.code === focal.code);
  const place = r.ranked.find((x) => x.code === focal.code);
  if (!cell || !place) {
    const why = cell?.suppressed ? `base too small (n=${cell.base})` : (cell?.reason ?? "not asked about this brand");
    return `${focal.label}: no figure, ${why.replace(/\.$/, "")}.${left ? ` ${left}.` : ""}`;
  }
  const of = `${ADJECTIVE[step.from] ?? lower(step.from)} respondents`;
  return `${focal.label} converts ${Math.round(place.conversion)}% of ${of} to ${lower(step.to)}, ${ordinal(place.rank)} of ${r.ranked.length} ${r.ranked.length === 1 ? "brand" : "brands"}${left ? `; ${left}` : ""}.`;
}
