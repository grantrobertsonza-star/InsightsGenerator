import type { PoolClient } from "pg";
import {
  classifyFindingDiscovery,
  summarizeSynthesizedProvenance,
  verificationCaption,
  type DiscoverySource,
  type InputCompleteness,
} from "./discoveryClassification";
import { loadInputCompleteness } from "./inputCompleteness";
import { findingSourceSql, formatFindingSource } from "./sourceAttribution";
import { SUPPORT_STATUS_LABEL, summariseSupport, type InsightSupport, type SupportStatus } from "./supportStatusShared";
import { latestVerdictLateral } from "./latestVerdict";

// A report that lists every net-new finding would bury its own argument.
// The Findings section already carries each verified finding; this section's
// job is to say what the analysis ADDED, so it shows the strongest few and
// states how many more there are.
const MAX_NET_NEW_FINDINGS_LISTED = 12;

export type NetNewInsightEntry = {
  /** The synthesized insight's id: its support is checked by id (applySupportToDiscovery). */
  id: string;
  headline: string;
  implication: string;
  qualityTier: "finding" | "partial" | "qualified" | null;
  /** "New: combines 3 claims the report itself made into something none of them said alone." */
  provenanceCaption: string;
  /** Set by applySupportToDiscovery when the insight's support changed or could not be checked:
   * the reason, shown next to the insight. Absent when support is current. */
  supportNote?: string;
};

export type NetNewFindingEntry = {
  text: string;
  theme: string | null;
  verdictTier: "robust" | "use_with_caution";
  /** The finding's own source ("survey.xlsx, Table 3"), or null when none is recorded. */
  source: string | null;
};

export type ContradictionEntry = {
  originalText: string;
  contradictingText: string;
  /** net_new_*: the Elevator's own analysis. report_claim: another claim in the same report. */
  contradictedBy: "net_new_finding" | "net_new_insight" | "report_claim";
  /** The contradicting synthesized insight, when contradictedBy is net_new_insight. */
  contradictingInsightId: string | null;
  /** The contradicting finding's review status, when a finding (not an insight) contradicts. */
  contradictingFindingStatus: string | null;
  /** When a finding contradicts: whether it is still what it was when the contradiction was found
   * (contradictionFindingSupport). Null when an insight contradicts. */
  contradictingFindingSupport: { status: SupportStatus; note: string | null } | null;
  rationale: string;
  /** As NetNewInsightEntry.supportNote, for a contradiction resting on a synthesized insight. */
  supportNote?: string;
};

export type DiscoveryReportData = {
  inputState: InputCompleteness;
  netNewSources: DiscoverySource[];
  /** Set when statistical verification could not run at all (see verificationCaption). */
  verificationNote: string | null;
  netNewInsights: NetNewInsightEntry[];
  netNewFindings: NetNewFindingEntry[];
  /** How many net-new findings exist beyond the ones listed. */
  netNewFindingsOmitted: number;
  contradictions: ContradictionEntry[];
};

/**
 * Everything the report's "new beyond the report" section needs, read in
 * one go from an already-open tenant-scoped client (the export routes hold
 * one). Scoped to the same accepted-evidence boundary as the rest of the
 * report: accepted findings that passed verification, accepted synthesized
 * insights.
 */
export async function loadDiscoveryReportData(
  client: PoolClient,
  runId: string,
): Promise<DiscoveryReportData> {
  const completeness = await loadInputCompleteness(client, runId);

  const insightRows = await client.query<{
    id: string;
    headline: string;
    implication: string;
    quality_tier: "finding" | "partial" | "qualified" | null;
    corroborating: boolean[];
    origins: string[];
  }>(
    `select si.id, si.headline, si.implication, si.quality_tier,
            array_agg(exists (select 1 from findings g where g.grounded_by_finding_id = pf.id)
                      order by pi.created_at) as corroborating,
            array_agg(pf.origin order by pi.created_at) as origins
     from synthesized_insights si
     join synthesized_insight_sources s on s.synthesized_insight_id = si.id
     join insights pi on pi.id = s.pre_insight_id
     join findings pf on pf.id = pi.finding_id
     where si.run_id = $1 and si.review_status = 'accepted'
     group by si.id
     order by si.quality_score desc nulls last, si.created_at`,
    [runId],
  );
  const netNewInsights: NetNewInsightEntry[] = insightRows.rows.map((row) => {
    const memberTypes = row.origins.map(
      (origin, index) =>
        classifyFindingDiscovery({
          origin: origin as "stated" | "generated" | "coded",
          corroboratesReportClaim: row.corroborating[index] === true,
        }).type,
    );
    return {
      id: row.id,
      headline: row.headline,
      implication: row.implication,
      qualityTier: row.quality_tier,
      provenanceCaption: summarizeSynthesizedProvenance(memberTypes).caption,
    };
  });

  // A computed finding no report claim points at is net-new; one a report
  // claim IS grounded in exists to check the report, so it is validated and
  // already represented under the claim it supports.
  const src = findingSourceSql("f");
  const findingRows = await client.query<{
    finding_text: string;
    theme: string | null;
    verdict_tier: "robust" | "use_with_caution";
    source_filename: string | null;
    source_page: number | null;
    source_table_label: string | null;
  }>(
    `select f.finding_text, f.theme, v.verdict_tier, ${src.columns}
     from findings f
     join ${latestVerdictLateral("f.id", ["verdict_tier"])} v on true
     ${src.join}
     where f.run_id = $1
       and f.origin = 'generated'
       and f.status = 'accepted'
       and v.verdict_tier in ('robust', 'use_with_caution')
       and not exists (select 1 from findings g where g.grounded_by_finding_id = f.id)
     order by case v.verdict_tier when 'robust' then 0 else 1 end, f.theme nulls last, f.created_at`,
    [runId],
  );
  const netNewFindings = findingRows.rows
    .slice(0, MAX_NET_NEW_FINDINGS_LISTED)
    .map((row) => ({
      text: row.finding_text,
      theme: row.theme,
      verdictTier: row.verdict_tier,
      source: formatFindingSource(row),
    }));

  const contradictionRows = await client.query<{
    original_text: string;
    rationale: string;
    contradicting_text: string | null;
    contradicting_origin: string | null;
    synth_headline: string | null;
    contradicting_insight_id: string | null;
    contradicting_status: string | null;
    detected_at: string;
    provenance_tracked: boolean;
    contradicting_edited_at: string | null;
    contradicting_edited_fields: string[] | null;
  }>(
    `select orig.finding_text as original_text, fc.rationale,
            cf.finding_text as contradicting_text, cf.origin as contradicting_origin, cf.status as contradicting_status,
            fc.created_at::text as detected_at,
            -- Read through to_jsonb so this works before migration 0094 (no provenance columns).
            coalesce((to_jsonb(cf) ? 'human_edited_at'), false) as provenance_tracked,
            to_jsonb(cf)->>'human_edited_at' as contradicting_edited_at,
            case when jsonb_typeof(to_jsonb(cf)->'human_edited_fields') = 'array'
                 then array(select jsonb_array_elements_text(to_jsonb(cf)->'human_edited_fields')) end as contradicting_edited_fields,
            si.headline as synth_headline, si.id as contradicting_insight_id
     from finding_contradictions fc
     join findings orig on orig.id = fc.original_finding_id
     left join findings cf on cf.id = fc.contradicting_finding_id
     left join synthesized_insights si on si.id = fc.contradicting_synthesized_insight_id
     where fc.run_id = $1
     order by fc.created_at`,
    [runId],
  );
  const contradictions: ContradictionEntry[] = contradictionRows.rows.map(
    (row) => {
      if (row.contradicting_text !== null) {
        return {
          originalText: row.original_text,
          contradictingText: row.contradicting_text,
          contradictedBy:
            row.contradicting_origin === "generated"
              ? "net_new_finding"
              : "report_claim",
          contradictingInsightId: null,
          contradictingFindingStatus: row.contradicting_status,
          contradictingFindingSupport: contradictionFindingSupport({
            status: row.contradicting_status,
            detectedAt: row.detected_at,
            provenanceTracked: row.provenance_tracked,
            editedAt: row.contradicting_edited_at,
            editedFields: row.contradicting_edited_fields,
          }),
          rationale: row.rationale,
        };
      }
      return {
        originalText: row.original_text,
        contradictingText: row.synth_headline ?? "a synthesized insight",
        contradictedBy: "net_new_insight",
        contradictingInsightId: row.contradicting_insight_id,
        contradictingFindingStatus: null,
        contradictingFindingSupport: null,
        rationale: row.rationale,
      };
    },
  );

  // Only worth saying when verification genuinely could not run: with data
  // in the run, individual claims carry their own caption instead.
  const verificationNote =
    completeness.state === "report_only" || completeness.state === "none"
      ? verificationCaption("report_only", completeness.state)
      : null;

  return {
    inputState: completeness.state,
    netNewSources: completeness.netNewSources,
    verificationNote,
    netNewInsights,
    netNewFindings,
    netNewFindingsOmitted: Math.max(
      0,
      findingRows.rows.length - netNewFindings.length,
    ),
    contradictions,
  };
}

/** Something the discovery section left out. kind "insight": a synthesized insight (insightId set);
 * kind "contradiction": a contradiction whose contradicting finding was rejected (insightId null). */
/**
 * FND-001's support policy for a contradiction backed directly by a FINDING (an insight-backed one
 * uses the insight's own support status). The finding row still exists here: deleting it removes
 * the contradiction with it (0042, on delete cascade).
 *   - rejected by the researcher: invalid; left out and disclosed
 *   - its wording (finding_text) edited after the contradiction was found: changed; shown with
 *     that note, because the contradiction was judged on the earlier wording
 *   - edit provenance not recorded (before migration 0094): not checked; shown with that note,
 *     never assumed current
 *   - otherwise current
 * Other edits (theme, kind, note) do not change what the finding says, so they leave it current.
 */
export function contradictionFindingSupport(f: {
  status: string | null;
  detectedAt: string;
  provenanceTracked: boolean;
  editedAt: string | null;
  editedFields: string[] | null;
}): { status: SupportStatus; note: string | null } {
  if (f.status === "rejected") return { status: "invalid", note: "the contradicting finding was rejected" };
  if (!f.provenanceTracked) {
    return { status: "unknown", note: "whether the contradicting finding changed since this contradiction was found could not be checked (edit tracking not available)" };
  }
  if (f.editedAt && (f.editedFields ?? []).includes("finding_text") && Date.parse(f.editedAt) > Date.parse(f.detectedAt)) {
    return { status: "stale", note: "the contradicting finding's wording was edited after this contradiction was found" };
  }
  return { status: "current", note: null };
}

export type DiscoveryExclusion = { kind: "insight" | "contradiction"; insightId: string | null; headline: string; reason: string };

/**
 * FND-001 for the "new beyond the report" section: the same support rule the rest of each export
 * applies (supportStatus.ts), applied here so an insight left out of the narrative's own sections
 * cannot come back as ordinary content in this one.
 *   - invalid support (a source finding rejected or deleted): the insight is removed from the
 *     new-insights list, and so is a contradiction that rests on it; each is returned in
 *     `excluded` for the caller's own exclusion disclosure (the "Evidence status" slide, the
 *     "Excluded from this report" section)
 *   - a contradiction whose contradicting FINDING was rejected: removed and returned the same way
 *   - changed or uncheckable support: kept, with the reason as `supportNote` beside it
 *   - current: unchanged
 * Pure: reads nothing and writes nothing; the caller supplies the statuses it already loaded.
 */
export function applySupportToDiscovery(
  d: DiscoveryReportData,
  statusOf: (insightId: string) => InsightSupport,
): { discovery: DiscoveryReportData; excluded: DiscoveryExclusion[] } {
  const excluded: DiscoveryExclusion[] = [];
  const netNewInsights: NetNewInsightEntry[] = [];
  for (const insight of d.netNewInsights) {
    const s = statusOf(insight.id);
    if (s.status === "invalid") {
      excluded.push({ kind: "insight", insightId: insight.id, headline: insight.headline, reason: summariseSupport(s) });
      continue;
    }
    netNewInsights.push(s.status === "current" ? insight : { ...insight, supportNote: summariseSupport(s) });
  }
  const contradictions: ContradictionEntry[] = [];
  for (const c of d.contradictions) {
    if (!c.contradictingInsightId) {
      // A contradiction resting on a finding the researcher rejected is no longer evidence against
      // the report's claim: left out here and disclosed by the caller, like an invalid insight.
      const fs = c.contradictingFindingSupport;
      if (fs?.status === "invalid") {
        excluded.push({
          kind: "contradiction",
          insightId: null,
          headline: `“${c.originalText}”, contradicted by “${c.contradictingText}”`,
          reason: fs.note ?? "the contradicting finding is no longer valid",
        });
      } else if (fs && fs.status !== "current") contradictions.push({ ...c, supportNote: `${SUPPORT_STATUS_LABEL[fs.status]}: ${fs.note}` });
      else contradictions.push(c);
      continue;
    }
    const s = statusOf(c.contradictingInsightId);
    if (s.status === "current") contradictions.push(c);
    else if (s.status !== "invalid") contradictions.push({ ...c, supportNote: summariseSupport(s) });
    else if (!excluded.some((e) => e.insightId === c.contradictingInsightId)) {
      excluded.push({ kind: "insight", insightId: c.contradictingInsightId, headline: c.contradictingText, reason: summariseSupport(s) });
    }
  }
  return { discovery: { ...d, netNewInsights, contradictions }, excluded };
}

/** Every synthesized insight the discovery section would show, for the caller's support check. */
export function discoveryInsightIds(d: DiscoveryReportData): string[] {
  return [
    ...d.netNewInsights.map((i) => i.id),
    ...d.contradictions.flatMap((c) => (c.contradictingInsightId ? [c.contradictingInsightId] : [])),
  ];
}
