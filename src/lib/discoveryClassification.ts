// The validated / net-new split, right before the report is built.
//
// Every finding the pipeline is holding falls on one of two sides:
//
// - validated: it traces back to something the original report or
//   transcript already said. A stated or coded finding is validated by
//   definition (it IS the report's own claim), and a computed finding that
//   independently corroborates a stated claim (grounded_by_finding_id on
//   that claim points at it) is validated too, since it exists to check
//   what the report said rather than to add to it.
//
// - net_new: it only exists because the Elevator's own analysis surfaced
//   it. Today that means a computed finding mined from a raw or aggregated
//   table that no report claim points at, and any synthesized insight.
//
// Synthesized insights are always net_new, even when every pre-insight
// underneath them is validated: the combination was never stated by the
// report, so it is the Elevator's own contribution. Both facts are kept and
// shown, though. The label says net_new, and the provenance says how much of
// it stands on validated claims (see summarizeSynthesizedProvenance), so a
// reader sees "new, and built on N claims the report itself made".
//
// None of this is stored on a row. It is derived from columns that already
// exist, so it cannot drift from them.

export type DiscoveryType = "validated" | "net_new";

/**
 * Where a net-new item came from. evidence_memory (cross-referencing the
 * report's claims against accumulated prior research) is part of the model
 * but is not built yet, so nothing produces it today; it is listed so a
 * stored value or a future producer has a name to use.
 */
export type DiscoverySource =
  "raw_data_mining" | "synthesis" | "evidence_memory";

export type FindingOrigin = "stated" | "generated" | "coded";

export type FindingDiscovery = {
  type: DiscoveryType;
  /** Only set for net_new. */
  source: DiscoverySource | null;
};

export function classifyFindingDiscovery(input: {
  origin: FindingOrigin;
  /** True when some stated finding's grounded_by_finding_id points at this one. */
  corroboratesReportClaim: boolean;
}): FindingDiscovery {
  if (input.origin === "stated" || input.origin === "coded") {
    return { type: "validated", source: null };
  }
  if (input.corroboratesReportClaim) {
    return { type: "validated", source: null };
  }
  return { type: "net_new", source: "raw_data_mining" };
}

export type SynthesizedProvenance = {
  type: "net_new";
  source: "synthesis";
  validatedMemberCount: number;
  netNewMemberCount: number;
  /** One plain sentence for the UI and the report. */
  caption: string;
};

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * A synthesized insight is net-new by synthesis. This records how much of
 * it rests on validated claims, so the label never has to hide that.
 */
export function summarizeSynthesizedProvenance(
  memberTypes: DiscoveryType[],
): SynthesizedProvenance {
  const validatedMemberCount = memberTypes.filter(
    (t) => t === "validated",
  ).length;
  const netNewMemberCount = memberTypes.length - validatedMemberCount;

  let caption: string;
  if (memberTypes.length === 0) {
    caption =
      "New: found by combining findings. No source findings are recorded for it.";
  } else if (netNewMemberCount === 0) {
    caption = `New: combines ${pluralize(validatedMemberCount, "claim")} the report itself made into something none of them said alone.`;
  } else if (validatedMemberCount === 0) {
    caption = `New: built entirely from ${pluralize(netNewMemberCount, "net-new finding")} the report did not contain.`;
  } else {
    caption =
      `New: combines ${pluralize(validatedMemberCount, "claim")} from the report with ` +
      `${pluralize(netNewMemberCount, "net-new finding")} into something the report did not say.`;
  }

  return {
    type: "net_new",
    source: "synthesis",
    validatedMemberCount,
    netNewMemberCount,
    caption,
  };
}

// ---------------------------------------------------------------------------
// Input completeness
// ---------------------------------------------------------------------------

/**
 * What the client actually supplied, which decides what can be checked.
 *
 * - report_and_data: both axes can run. Statistical verification where a
 *   computed pattern exists, quality scoring everywhere.
 * - report_only: no tables behind the report. There is nothing to recompute
 *   a statistic from or cross-check a stated figure against, so statistical
 *   verification is not available (not failed, just not applicable). The
 *   quality score still runs: it is a read of the claim and its own
 *   reasoning, and needs no underlying data.
 * - data_only: no report. Statistical verification runs on whatever is
 *   mined, and quality scoring runs on the Elevator's own insights, with no
 *   client claim to compare against.
 */
export type InputCompleteness =
  "report_and_data" | "report_only" | "data_only" | "none";

export function classifyInputCompleteness(input: {
  hasReport: boolean;
  hasData: boolean;
}): InputCompleteness {
  if (input.hasReport && input.hasData) return "report_and_data";
  if (input.hasReport) return "report_only";
  if (input.hasData) return "data_only";
  return "none";
}

/**
 * Which sources of net-new insight are open for this input. Mining raw
 * tables needs tables. Synthesis only needs claims to combine, so it is
 * open whenever anything was supplied. evidence_memory is deliberately not
 * returned: it is not built yet, and listing it as available would claim a
 * capability the pipeline does not have.
 */
export function availableNetNewSources(
  state: InputCompleteness,
): DiscoverySource[] {
  const sources: DiscoverySource[] = [];
  if (state === "report_and_data" || state === "data_only")
    sources.push("raw_data_mining");
  if (state !== "none") sources.push("synthesis");
  return sources;
}

// ---------------------------------------------------------------------------
// Verification basis
// ---------------------------------------------------------------------------

/**
 * What a verdict actually rested on. data_backed means code-computed
 * statistics (a computed finding, a claim grounded in one, or a chain-trace
 * that relied on at least one computed finding). report_only means the
 * judgment rested on the report's own wording, so it is a plausibility
 * read, not a check against data.
 */
export type VerificationBasis = "data_backed" | "report_only";

export function verificationBasisFor(input: {
  origin: FindingOrigin;
  groundedByComputedFinding: boolean;
  reliedOnComputedEvidence: boolean;
}): VerificationBasis {
  if (input.origin === "generated") return "data_backed";
  if (input.groundedByComputedFinding || input.reliedOnComputedEvidence)
    return "data_backed";
  return "report_only";
}

/**
 * The line shown next to a verdict that was not data-backed, or null when
 * there is nothing to say. Two different messages, because "you did not send
 * us the numbers" and "we had numbers but none of them address this claim"
 * are different situations.
 */
export function verificationCaption(
  basis: VerificationBasis,
  state: InputCompleteness,
): string | null {
  if (basis === "data_backed") return null;
  if (state === "report_only" || state === "none") {
    return "Statistical verification unavailable: no underlying data was supplied. Judged on the report's own wording only.";
  }
  return "Not checked against the supplied data: no computed pattern matches this claim. Judged on the report's own wording only.";
}

// ---------------------------------------------------------------------------
// Contradictions
// ---------------------------------------------------------------------------

export type ContradictorKind = "finding" | "synthesized_insight";

/**
 * The tier a contradicted original is forced to, whatever it scored before.
 * A claim the Elevator's own evidence conflicts with does not get to keep a
 * favourable validity rating.
 */
export const CONTRADICTED_TIER = "not_supported" as const;

export function contradictionRationale(input: {
  kind: ContradictorKind;
  contradictingText: string;
  detail: string;
  previousRationale: string | null;
}): string {
  const who =
    input.kind === "finding"
      ? "a net-new finding"
      : "a net-new synthesized insight";
  const head =
    `Contradicted by ${who}: "${input.contradictingText}". ${input.detail}`.trim();
  return input.previousRationale
    ? `${head} (Earlier assessment: ${input.previousRationale})`
    : head;
}
