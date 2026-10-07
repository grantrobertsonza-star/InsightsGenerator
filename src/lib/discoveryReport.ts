import type { PoolClient } from "pg";
import {
  classifyFindingDiscovery,
  summarizeSynthesizedProvenance,
  verificationCaption,
  type DiscoverySource,
  type InputCompleteness,
} from "./discoveryClassification";
import { loadInputCompleteness } from "./inputCompleteness";

// A report that lists every net-new finding would bury its own argument.
// The Findings section already carries each verified finding; this section's
// job is to say what the analysis ADDED, so it shows the strongest few and
// states how many more there are.
const MAX_NET_NEW_FINDINGS_LISTED = 12;

export type NetNewInsightEntry = {
  headline: string;
  implication: string;
  qualityTier: "finding" | "partial" | "qualified" | null;
  /** "New: combines 3 claims the report itself made into something none of them said alone." */
  provenanceCaption: string;
};

export type NetNewFindingEntry = {
  text: string;
  theme: string | null;
  verdictTier: "robust" | "use_with_caution";
};

export type ContradictionEntry = {
  originalText: string;
  contradictingText: string;
  /** net_new_*: the Elevator's own analysis. report_claim: another claim in the same report. */
  contradictedBy: "net_new_finding" | "net_new_insight" | "report_claim";
  rationale: string;
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
    headline: string;
    implication: string;
    quality_tier: "finding" | "partial" | "qualified" | null;
    corroborating: boolean[];
    origins: string[];
  }>(
    `select si.headline, si.implication, si.quality_tier,
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
      headline: row.headline,
      implication: row.implication,
      qualityTier: row.quality_tier,
      provenanceCaption: summarizeSynthesizedProvenance(memberTypes).caption,
    };
  });

  // A computed finding no report claim points at is net-new; one a report
  // claim IS grounded in exists to check the report, so it is validated and
  // already represented under the claim it supports.
  const findingRows = await client.query<{
    finding_text: string;
    theme: string | null;
    verdict_tier: "robust" | "use_with_caution";
  }>(
    `select f.finding_text, f.theme, v.verdict_tier
     from findings f
     join verdicts v on v.finding_id = f.id
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
    }));

  const contradictionRows = await client.query<{
    original_text: string;
    rationale: string;
    contradicting_text: string | null;
    contradicting_origin: string | null;
    synth_headline: string | null;
  }>(
    `select orig.finding_text as original_text, fc.rationale,
            cf.finding_text as contradicting_text, cf.origin as contradicting_origin,
            si.headline as synth_headline
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
          rationale: row.rationale,
        };
      }
      return {
        originalText: row.original_text,
        contradictingText: row.synth_headline ?? "a synthesized insight",
        contradictedBy: "net_new_insight",
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
