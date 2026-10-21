// FND-001 / REP-OUT-001 and ANA-NPS-003 downstream freshness: the one definition of whether a
// synthesized insight's supporting evidence is still what it was when the insight was drafted.
//
// Client-safe on purpose (no database, no server-only imports), like variableOverrideTypes.ts:
// the review screens import the labels and descriptions from here, and the server-side loader in
// supportStatus.ts imports the classifier from here, so every consumer (run page, both story
// exports, the insight CSV/deck exports and the generators) applies exactly the same rule.
//
// Support status is a separate axis from acceptance. Accepting an insight says a researcher
// agreed with it; it does not make its sources current. Nothing here writes, deletes or rewrites
// anything: an insight whose support changed keeps its wording and review decision, and is only
// shown (and exported) with the change made visible.

export type SupportStatus = "current" | "stale" | "invalid" | "unknown";

export type SupportReasonKind =
  /** The insight has no remaining source links at all. */
  | "no_sources"
  /** Fewer source links remain than the insight was built from: a supporting finding (and so its
   * pre-insight and link) was deleted or replaced by a re-read. */
  | "source_missing"
  /** A supporting finding was rejected after the insight was drafted. */
  | "rejected"
  /** A supporting report finding's recorded quote no longer appears in the text its report was last
   * read as (GT100-F02): the evidence it cites is gone from its source. The finding, its wording and
   * its review decision are kept; only its support is no longer valid. */
  | "quote_missing"
  /** A supporting finding's wording changed in place (same id). */
  | "wording"
  /** A supporting finding's stated figures changed in place. */
  | "figures"
  /** A supporting finding's latest verification verdict changed. */
  | "verdict"
  /** The calculated table behind a supporting finding was rebuilt with different settings. */
  | "calculation"
  /** The survey design now in force for that table's data file differs from the one it was
   * calculated with (the table has not been recalculated since). */
  | "design_changed"
  /** The variable corrections now saved for that data file differ from the ones the table was
   * calculated with. */
  | "corrections_changed"
  /** The source was linked before support tracking existed (or the migration is not applied), so
   * a change cannot be detected. Never treated as current. */
  | "not_recorded"
  /** A lookup needed for the check failed. Never treated as current. */
  | "check_failed";

export type SupportReason = {
  kind: SupportReasonKind;
  findingId: string | null;
  findingText: string | null;
  detail?: string;
};

export type InsightSupport = { status: SupportStatus; reasons: SupportReason[] };

/** One finding's fingerprint, exactly as finding_support_parts() (migration 0096) returns it. */
export type SupportParts = {
  wording: string;
  figures: string;
  verdict: string | null;
  calculation: string | null;
};

/** One row per (insight, source link); an insight with no links yields one row with linkId null. */
export type SupportLinkRow = {
  insightId: string;
  triangulationCount: number;
  linkId: string | null;
  findingId: string | null;
  findingStatus: string | null;
  findingText: string | null;
  /** support_snapshot recorded when the insight was drafted; null for legacy links. */
  recorded: SupportParts | null;
  /** finding_support_parts() now; null when the finding no longer exists. */
  current: SupportParts | null;
  /** Data file behind the finding's calculated table; null when the finding is not from a
   * calculated table (report text, report tables, coded transcripts), where current survey
   * settings do not apply. */
  calculatedTableDocumentId: string | null;
  designSnapshot: { design: { psu: string | null; strata: string | null } | null } | null;
  overridesSnapshot: unknown;
  /**
   * For a finding read from a report (origin 'stated') with a recorded quote: whether that quote
   * appears in the report's CURRENT stored text (quoteMatch.quoteGroundingChecker). "unreadable"
   * when there is no usable stored text to check against. Null or absent: not a quoted report
   * finding, so there is nothing to check.
   */
  quoteGrounding?: "present" | "missing" | "unreadable" | null;
  /** Variables the calculated table used (tableVariablesFromSavedRequest), so only corrections to
   * THOSE variables mark it changed. Null/absent: not recorded, compared file-wide (cautious). */
  tableVariables?: string[] | null;
};

/**
 * The variables a calculated table depends on, from its saved request, read the way the engine
 * reads the request (api/parse-stats-file.py crosstab): the banner columns, every row item's
 * variables and, for a NET row, each NET's member variables (the UI saves NET rows with `vars: []`
 * and the members under `nets[].vars`: Codex GT100-F03), the filters and the older single `layer`
 * filter, the weight, and a survey design's PSU and strata when the request names them.
 * Corrections are saved per variable, so a correction to a variable the table never used cannot
 * change it; comparing the whole file's corrections marked every table from that file "changed"
 * after one unrelated correction.
 *
 * Null means the dependencies cannot be resolved from the request, and the caller compares
 * file-wide (the cautious fallback): no recorded request, a request in a shape this does not
 * recognise, or a multiple-response banner set ("set:<key>"), whose member variables the engine
 * resolves from the file at build time and the request does not record.
 */
export function tableVariablesFromSavedRequest(saved: unknown): string[] | null {
  if (!saved || typeof saved !== "object") return null;
  const r = saved as {
    columnVars?: unknown;
    rowItems?: unknown;
    filters?: unknown;
    layer?: unknown;
    weightVar?: unknown;
    design?: unknown;
  };
  if (!Array.isArray(r.rowItems) && !Array.isArray(r.columnVars)) return null;
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && v) out.add(v);
  };
  // A list that is present but not a list of names is a shape the engine would not read either.
  const names = (list: unknown): string[] | null =>
    list === undefined || list === null ? [] : Array.isArray(list) && list.every((v) => typeof v === "string") ? (list as string[]) : null;

  const columns = names(r.columnVars);
  if (!columns) return null;
  for (const c of columns) {
    if (c.startsWith("set:")) return null;
    add(c);
  }
  for (const item of Array.isArray(r.rowItems) ? r.rowItems : []) {
    if (!item || typeof item !== "object") return null;
    const { vars, nets } = item as { vars?: unknown; nets?: unknown };
    const own = names(vars);
    if (!own) return null;
    own.forEach(add);
    if (nets !== undefined && nets !== null) {
      if (!Array.isArray(nets)) return null;
      for (const net of nets) {
        const listed = (net as { vars?: unknown } | null)?.vars;
        const members = Array.isArray(listed) ? names(listed) : null;
        if (!members) return null;
        members.forEach(add);
      }
    }
  }
  for (const f of Array.isArray(r.filters) ? r.filters : []) add((f as { variable?: unknown } | null)?.variable);
  add((r.layer as { variable?: unknown } | null)?.variable);
  add(r.weightVar);
  const design = r.design as { psu?: unknown; strata?: unknown } | null | undefined;
  add(design?.psu);
  add(design?.strata);
  return Array.from(out);
}

/** The part of a per-variable corrections map that concerns `variables` (all of it when null). */
export function correctionsFor(overrides: unknown, variables: string[] | null | undefined): unknown {
  if (!variables || !overrides || typeof overrides !== "object" || Array.isArray(overrides)) return overrides;
  const map = overrides as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const v of variables) if (v in map) out[v] = map[v];
  return out;
}

/** Freshness of one calculated table against its data file's current settings. */
export type SettingsFreshness = "current" | "stale" | "unknown";

/** Current settings for one data file, as resolved at check time. */
export type DocumentSettingsCheck = {
  design: (snapshot: SupportLinkRow["designSnapshot"]) => SettingsFreshness;
  corrections: (snapshot: unknown, tableVariables?: string[] | null) => SettingsFreshness;
  error?: string;
};

const PRECEDENCE: Record<SupportStatus, number> = { invalid: 3, stale: 2, unknown: 1, current: 0 };

/** Invalid outranks stale outranks unknown outranks current. */
export function worstSupportStatus(statuses: SupportStatus[]): SupportStatus {
  let worst: SupportStatus = "current";
  for (const s of statuses) if (PRECEDENCE[s] > PRECEDENCE[worst]) worst = s;
  return worst;
}

const REASON_STATUS: Record<SupportReasonKind, SupportStatus> = {
  no_sources: "invalid",
  source_missing: "invalid",
  rejected: "invalid",
  // Evidence gone from its source is treated as a deleted source is (source_missing): no longer valid.
  quote_missing: "invalid",
  wording: "stale",
  figures: "stale",
  verdict: "stale",
  calculation: "stale",
  design_changed: "stale",
  corrections_changed: "stale",
  not_recorded: "unknown",
  check_failed: "unknown",
};

/**
 * Classifies one insight from its source-link rows. Pure: the caller supplies the rows and the
 * per-data-file settings checks. `snapshotsAvailable` is false when migration 0096 is not
 * applied, in which case every link is "not recorded" (unknown) - rejection and deletion are
 * still detected, because they need no snapshot.
 */
export function classifyInsightSupport(
  rows: SupportLinkRow[],
  settingsByDocument: Map<string, DocumentSettingsCheck>,
  snapshotsAvailable: boolean,
): InsightSupport {
  const reasons: SupportReason[] = [];
  const links = rows.filter((r) => r.linkId !== null);
  const triangulationCount = rows[0]?.triangulationCount ?? 0;

  if (links.length === 0) {
    reasons.push({ kind: "no_sources", findingId: null, findingText: null });
  } else if (links.length < triangulationCount) {
    // Same signal the Brief 35 export guard used (verified then): the synthesizer stores one link
    // per distinct cluster member and sets triangulation_count to that number, so fewer links
    // now means a supporting finding was deleted (cascading its pre-insight and link).
    const missing = triangulationCount - links.length;
    reasons.push({
      kind: "source_missing",
      findingId: null,
      findingText: null,
      detail: `${missing} of ${triangulationCount} supporting findings no longer exist`,
    });
  }

  for (const link of links) {
    const base = { findingId: link.findingId, findingText: link.findingText };
    if (!link.findingId) {
      reasons.push({ kind: "source_missing", ...base });
      continue;
    }
    if (link.findingStatus === "rejected") {
      reasons.push({ kind: "rejected", ...base });
      continue;
    }
    // GT100-F02: a kept report finding keeps its id, wording and fingerprint through a re-read, so
    // the fingerprint alone cannot see that its quote is no longer in the report. Checked against
    // the report's current stored text; text too short or absent to judge is "could not check".
    if (link.quoteGrounding === "missing") {
      reasons.push({ kind: "quote_missing", ...base });
    } else if (link.quoteGrounding === "unreadable") {
      reasons.push({ kind: "check_failed", ...base, detail: "its report's stored text could not be read to check the quote" });
    }
    if (!snapshotsAvailable || !link.recorded) {
      reasons.push({ kind: "not_recorded", ...base });
    } else if (!link.current) {
      reasons.push({ kind: "source_missing", ...base });
      continue;
    } else {
      if (link.recorded.wording !== link.current.wording) reasons.push({ kind: "wording", ...base });
      if (link.recorded.figures !== link.current.figures) reasons.push({ kind: "figures", ...base });
      if ((link.recorded.verdict ?? null) !== (link.current.verdict ?? null)) {
        reasons.push({
          kind: "verdict",
          ...base,
          detail: `${link.recorded.verdict ?? "none"} → ${link.current.verdict ?? "none"}`,
        });
      }
      if ((link.recorded.calculation ?? null) !== (link.current.calculation ?? null)) {
        reasons.push({ kind: "calculation", ...base });
      }
    }
    if (link.calculatedTableDocumentId) {
      const check = settingsByDocument.get(link.calculatedTableDocumentId);
      if (!check) {
        reasons.push({ kind: "check_failed", ...base, detail: "current survey settings were not resolved" });
        continue;
      }
      const design = check.design(link.designSnapshot);
      const corrections = check.corrections(link.overridesSnapshot, link.tableVariables);
      if (design === "stale") reasons.push({ kind: "design_changed", ...base });
      if (corrections === "stale") reasons.push({ kind: "corrections_changed", ...base });
      if (design === "unknown" || corrections === "unknown") {
        reasons.push({
          kind: "check_failed",
          ...base,
          detail: check.error ?? "the table's calculation settings were not recorded",
        });
      }
    }
  }

  return { status: worstSupportStatus(reasons.map((r) => REASON_STATUS[r.kind])), reasons };
}

/** Short status names for badges. Words, never colour alone. */
export const SUPPORT_STATUS_LABEL: Record<SupportStatus, string> = {
  current: "Support current",
  stale: "Support changed since drafted",
  invalid: "Support no longer valid",
  unknown: "Support not checked",
};

function quoteFinding(text: string | null): string {
  if (!text) return "a supporting finding";
  const oneLine = text.replace(/\s+/g, " ").trim();
  return `“${oneLine.length > 70 ? `${oneLine.slice(0, 67)}...` : oneLine}”`;
}

export function describeSupportReason(reason: SupportReason): string {
  const f = quoteFinding(reason.findingText);
  switch (reason.kind) {
    case "no_sources":
      return "none of its supporting findings remain";
    case "source_missing":
      return reason.detail ?? `${f} no longer exists`;
    case "rejected":
      return `${f} was rejected`;
    case "quote_missing":
      return `the quote behind ${f} no longer appears in its report`;
    case "wording":
      return `the wording of ${f} changed`;
    case "figures":
      return `the figures in ${f} changed`;
    case "verdict":
      return `the verification verdict for ${f} changed${reason.detail ? ` (${reason.detail.replace(/_/g, " ")})` : ""}`;
    case "calculation":
      return `the table behind ${f} was recalculated with different settings`;
    case "design_changed":
      return `the survey design for the data behind ${f} changed after it was calculated`;
    case "corrections_changed":
      return `variable corrections for the data behind ${f} changed after it was calculated`;
    case "not_recorded":
      return "it was drafted before support tracking, so later changes cannot be detected";
    case "check_failed":
      return `its support could not be checked${reason.detail ? ` (${reason.detail})` : ""}`;
  }
}

/**
 * One readable sentence for a non-current insight: the status, then up to `limit` distinct
 * reasons. Identical reasons (e.g. "not recorded" on every legacy link) are said once. Empty
 * string for a current insight, so callers can render nothing.
 */
export function summariseSupport(support: InsightSupport, limit = 3): string {
  if (support.status === "current") return "";
  const relevant = support.reasons.filter((r) => REASON_STATUS[r.kind] === support.status);
  const distinct = Array.from(new Set(relevant.map(describeSupportReason)));
  const shown = distinct.slice(0, limit);
  const more = distinct.length - shown.length;
  const tail = more > 0 ? `; and ${more} more` : "";
  return `${SUPPORT_STATUS_LABEL[support.status]}: ${shown.join("; ")}${tail}.`;
}

/** The status a dependent artifact (a recommendation, a narrative) inherits from its anchors. */
export function inheritSupport(supports: InsightSupport[]): InsightSupport {
  return {
    status: worstSupportStatus(supports.map((s) => s.status)),
    reasons: supports.flatMap((s) => s.reasons),
  };
}

/** Used whenever a support check could not run at all: unknown, with the error visible. */
export function uncheckedSupport(error: string): InsightSupport {
  return { status: "unknown", reasons: [{ kind: "check_failed", findingId: null, findingText: null, detail: error }] };
}
