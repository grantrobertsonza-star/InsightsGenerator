/**
 * The overview dashboards that open the Findings and Insights sections (Grant, 2026-10-21: "high
 * level to start with, with the detail layered underneath"). Pure counting over the rows those
 * sections already load, so every figure on a dashboard is a count of records the Review tab shows,
 * and opening a figure filters the Review tab to exactly those records. Nothing here scores, ranks
 * by a new combined score, or changes a record. Safe to import in client code.
 */

/** Where a finding's evidence comes from, for the overview's "by source" rows. */
export type EvidenceKind = "survey" | "interviews" | "report" | "output" | "modelled";

export const EVIDENCE_KIND_LABEL: Record<EvidenceKind, string> = {
  survey: "Survey data and tables",
  interviews: "Interviews and groups",
  report: "Claims stated in reports",
  output: "Statistical output",
  modelled: "Modelled results",
};

/** One line on what each kind is and how it is checked; shown under its row. */
export const EVIDENCE_KIND_NOTE: Record<EvidenceKind, string> = {
  survey: "Cross tabs, readings, NPS, charts and dashboards worked out from the data, with their bases and tests.",
  interviews: "Themes coded from transcripts, with participant reach. Not comparable with survey percentages.",
  report: "What a report or deck says, checked against the data and the report's own figures.",
  output: "Results read from an analyst's statistical output and audited for internal consistency.",
  modelled: "Driver analyses and correlations: associations from a model, never shown as tested differences or causes.",
};

export const EVIDENCE_KINDS: EvidenceKind[] = ["survey", "interviews", "report", "output", "modelled"];

const OUTPUT_PATTERNS = new Set(["model_association", "cluster_profile", "segment_proportions"]);
const MODELLED_SOURCES = new Set(["scatter_tool", "wave_driver_tool"]);

export type OverviewFinding = {
  id: string;
  origin: "stated" | "generated" | "coded";
  data_type: "qualitative" | "quantitative" | null;
  theme: string | null;
  status: "pending" | "accepted" | "rejected";
  pattern_type: string | null;
  stated_stats: Record<string, unknown> | null;
  contradicts_report: boolean;
  is_contradicted: boolean;
  quote_match?: "exact" | "near" | "none" | null;
  designFreshness?: "current" | "stale" | "unknown" | null;
};

/**
 * The kind of evidence a finding stands on. Origin decides first (a report's claim stays a report
 * claim however it is worded; coded transcripts are interviews); then the stored method: findings
 * read from an analyst's output, then modelled ones (driver analysis, correlations); everything else
 * generated from data is survey data and tables.
 */
export function evidenceKindOf(f: Pick<OverviewFinding, "origin" | "data_type" | "pattern_type" | "stated_stats">): EvidenceKind {
  if (f.origin === "stated") return "report";
  if (f.origin === "coded") return "interviews";
  const source = typeof f.stated_stats?.source === "string" ? (f.stated_stats.source as string) : null;
  if (source === "uploaded_output" || (f.pattern_type !== null && OUTPUT_PATTERNS.has(f.pattern_type))) return "output";
  if (f.pattern_type === "driver" || f.pattern_type === "relationship" || (source !== null && MODELLED_SOURCES.has(source))) return "modelled";
  if (f.data_type === "qualitative") return "interviews";
  return "survey";
}

export type StatusCounts = { total: number; accepted: number; pending: number; rejected: number };

const emptyStatus = (): StatusCounts => ({ total: 0, accepted: 0, pending: 0, rejected: 0 });

function addStatus(c: StatusCounts, status: OverviewFinding["status"]) {
  c.total += 1;
  c[status] += 1;
}

export type ReportClaimTier = "robust" | "use_with_caution" | "not_supported" | "insufficient_information";

export const REPORT_CLAIM_LABEL: Record<ReportClaimTier | "unchecked", string> = {
  robust: "Supported",
  use_with_caution: "Use with caution",
  not_supported: "Not supported",
  insufficient_information: "Not enough information",
  unchecked: "Not checked yet",
};

export type ThemeRow = {
  /** The theme's key (themeKeyOf): what the review filters on. */
  key: string;
  /** The theme as shown: the stored text trimmed, or NO_THEME. */
  theme: string;
  byKind: Record<EvidenceKind, number>;
  status: StatusCounts;
  /** Findings in this theme that a report claim contradicts, or that contradict the report. */
  contradictions: number;
  /** Findings whose source table's survey design changed since it was built, or could not be checked. */
  designChanged: number;
  designUnknown: number;
};

export type FindingsOverview = {
  status: StatusCounts;
  byKind: { kind: EvidenceKind; status: StatusCounts }[];
  themes: ThemeRow[];
  /** Report claims by their latest verdict; unchecked counts claims with no verdict yet. */
  reportClaims: Record<ReportClaimTier | "unchecked", number> & { total: number };
  attention: {
    pending: number;
    contradictions: number;
    designChanged: number;
    designUnknown: number;
    quoteNotFound: number;
    claimsNotSupported: number;
  };
};

/** The name shown for a finding with no theme. */
export const NO_THEME = "No theme";
/**
 * The key shared by findings with no theme: missing, empty and whitespace-only alike. Not a
 * readable word, so a researcher's theme that happens to read "No theme" stays its own theme.
 */
export const NO_THEME_KEY = "\u0000no-theme";

/**
 * The one rule for which theme a finding belongs to (Codex OV-03), used by the overview's counts,
 * its links and the review's theme filter alike: the stored text with surrounding spaces ignored,
 * and blank or missing themes together. Only the key is normalised; the researcher's stored
 * wording is never rewritten.
 */
export function themeKeyOf(theme: string | null | undefined): string {
  const t = theme?.trim();
  return t ? t : NO_THEME_KEY;
}

export function themeLabelOf(key: string): string {
  return key === NO_THEME_KEY ? NO_THEME : key;
}

export type FindingAttention = "contradictions" | "designChanged" | "designUnknown" | "quoteNotFound";

/**
 * Whether a finding needs a decision for `a`. The overview counts with this and the review filters
 * with it, so a figure opens exactly the findings it counted. Rejected findings are out of use and
 * never "need attention".
 */
export function findingNeedsAttention(
  f: Pick<OverviewFinding, "status" | "contradicts_report" | "is_contradicted" | "designFreshness" | "origin" | "quote_match">,
  a: FindingAttention,
): boolean {
  if (f.status === "rejected") return false;
  if (a === "contradictions") return f.contradicts_report || f.is_contradicted;
  if (a === "designChanged") return f.designFreshness === "stale";
  if (a === "designUnknown") return f.designFreshness === "unknown";
  return f.origin === "stated" && f.quote_match === "none";
}

export function summarizeFindings(
  findings: OverviewFinding[],
  claims: { verdict_tier: ReportClaimTier | null }[],
): FindingsOverview {
  const status = emptyStatus();
  const kinds = new Map<EvidenceKind, StatusCounts>(EVIDENCE_KINDS.map((k) => [k, emptyStatus()]));
  const themes = new Map<string, ThemeRow>();
  const attention = { pending: 0, contradictions: 0, designChanged: 0, designUnknown: 0, quoteNotFound: 0, claimsNotSupported: 0 };
  for (const f of findings) {
    const kind = evidenceKindOf(f);
    addStatus(status, f.status);
    addStatus(kinds.get(kind)!, f.status);
    const key = themeKeyOf(f.theme);
    let row = themes.get(key);
    if (!row) {
      row = { key, theme: themeLabelOf(key), byKind: { survey: 0, interviews: 0, report: 0, output: 0, modelled: 0 }, status: emptyStatus(), contradictions: 0, designChanged: 0, designUnknown: 0 };
      themes.set(key, row);
    }
    row.byKind[kind] += 1;
    addStatus(row.status, f.status);
    // Rejected findings are out of use: they are counted in the status bar, not raised for attention.
    if (f.status === "rejected") continue;
    if (f.status === "pending") attention.pending += 1;
    if (findingNeedsAttention(f, "contradictions")) {
      row.contradictions += 1;
      attention.contradictions += 1;
    }
    if (findingNeedsAttention(f, "designChanged")) {
      row.designChanged += 1;
      attention.designChanged += 1;
    } else if (findingNeedsAttention(f, "designUnknown")) {
      row.designUnknown += 1;
      attention.designUnknown += 1;
    }
    if (findingNeedsAttention(f, "quoteNotFound")) attention.quoteNotFound += 1;
  }
  const reportClaims = { robust: 0, use_with_caution: 0, not_supported: 0, insufficient_information: 0, unchecked: 0, total: claims.length };
  for (const c of claims) reportClaims[c.verdict_tier ?? "unchecked"] += 1;
  attention.claimsNotSupported = reportClaims.not_supported;
  return {
    status,
    byKind: EVIDENCE_KINDS.map((kind) => ({ kind, status: kinds.get(kind)! })).filter((k) => k.status.total > 0),
    // Largest first; "No theme" last so the named themes lead.
    themes: [...themes.values()].sort((a, b) => (a.key === NO_THEME_KEY ? 1 : b.key === NO_THEME_KEY ? -1 : b.status.total - a.status.total || a.theme.localeCompare(b.theme))),
    reportClaims,
    attention,
  };
}

// ----- insights -------------------------------------------------------------------------------

export type SupportState = "current" | "stale" | "invalid" | "unknown";
export const SUPPORT_STATES: SupportState[] = ["current", "stale", "invalid", "unknown"];
export const QUALITY_STATES = ["qualified", "partial", "finding", "unscored"] as const;
export const CORROBORATION_STATES = ["strong", "moderate", "exploratory", "unrated", "unchecked"] as const;
export const SUPPORT_LABEL: Record<SupportState, string> = {
  current: "Support current",
  stale: "Support changed",
  invalid: "Support no longer valid",
  unknown: "Support not checked",
};

export type OverviewInsight = {
  id: string;
  headline: string;
  implication: string;
  review_status: "accepted" | "rejected";
  quality_score: number | null;
  quality_tier: "finding" | "partial" | "qualified" | null;
  confidence_tier: "strong" | "moderate" | "exploratory" | null;
  independent_source_count: number | null;
  source_theme_count: number;
  support: { status: SupportState };
};

export type QualityState = (typeof QUALITY_STATES)[number];
/**
 * How independently an insight is corroborated (Codex OV-02). A stored confidence tier counts as
 * corroboration only once its sources were checked for independence (migration 0097): a null
 * `independent_source_count` means not checked, whatever tier a legacy row still carries, so it is
 * "unchecked" and never strong, moderate or exploratory. A checked insight with no tier is "unrated".
 */
export type CorroborationState = (typeof CORROBORATION_STATES)[number];

export function qualityStateOf(i: Pick<OverviewInsight, "quality_tier">): QualityState {
  return i.quality_tier ?? "unscored";
}

export function corroborationStateOf(i: Pick<OverviewInsight, "confidence_tier" | "independent_source_count">): CorroborationState {
  if (i.independent_source_count === null) return "unchecked";
  return i.confidence_tier ?? "unrated";
}

/**
 * What the Insights review shows. The overview counts each figure with `insightMatches` and the
 * filter that figure opens, and the review lists with the same function, so a figure always opens
 * the insights it counted (Codex OV-01). `review: "accepted"` is the overview's "in use": an
 * insight is either accepted or rejected, so accepted is exactly not rejected.
 */
export type InsightFilter = {
  review?: OverviewInsight["review_status"];
  support?: SupportState;
  quality?: QualityState;
  /** The stored triangulation tier, as the review's own Triangulation buttons filter it. */
  confidence?: NonNullable<OverviewInsight["confidence_tier"]>;
  corroboration?: CorroborationState;
};

export function insightMatches(
  i: Pick<OverviewInsight, "review_status" | "support" | "quality_tier" | "confidence_tier" | "independent_source_count">,
  f: InsightFilter,
): boolean {
  if (f.review && i.review_status !== f.review) return false;
  if (f.support && i.support.status !== f.support) return false;
  if (f.quality && qualityStateOf(i) !== f.quality) return false;
  if (f.confidence && i.confidence_tier !== f.confidence) return false;
  if (f.corroboration && corroborationStateOf(i) !== f.corroboration) return false;
  return true;
}

/** The filter behind each in-use figure of the overview: in use, plus the one state counted. */
export const IN_USE: InsightFilter = { review: "accepted" };
export const inUseWith = (f: InsightFilter): InsightFilter => ({ ...IN_USE, ...f });

export type InsightsOverview = {
  total: number;
  support: Record<SupportState, number>;
  quality: Record<QualityState, number>;
  corroboration: Record<CorroborationState, number>;
  review: { accepted: number; rejected: number };
  /** In use (not rejected), support current, highest stored quality first; at most `limit`. */
  top: OverviewInsight[];
};

export function summarizeInsights(insights: OverviewInsight[], limit = 3): InsightsOverview {
  // Each figure is the number of insights its own drill-down filter matches. Rejected insights are
  // out of use: counted under review only, so the other tiles describe what could still reach a report.
  const count = (f: InsightFilter) => insights.filter((i) => insightMatches(i, f)).length;
  const support = Object.fromEntries(SUPPORT_STATES.map((s) => [s, count(inUseWith({ support: s }))])) as Record<SupportState, number>;
  const quality = Object.fromEntries(QUALITY_STATES.map((q) => [q, count(inUseWith({ quality: q }))])) as Record<QualityState, number>;
  const corroboration = Object.fromEntries(CORROBORATION_STATES.map((c) => [c, count(inUseWith({ corroboration: c }))])) as Record<CorroborationState, number>;
  const review = { accepted: count({ review: "accepted" }), rejected: count({ review: "rejected" }) };
  // Ranked by the stored quality score only (no new combined score); ties by more independent
  // sources, then headline for a stable order. An unscored insight is never ranked above a scored one.
  const top = insights
    .filter((i) => insightMatches(i, inUseWith({ support: "current" })))
    .sort(
      (a, b) =>
        (b.quality_score ?? -1) - (a.quality_score ?? -1) ||
        (b.independent_source_count ?? -1) - (a.independent_source_count ?? -1) ||
        a.headline.localeCompare(b.headline),
    )
    .slice(0, limit);
  return { total: insights.length, support, quality, corroboration, review, top };
}
