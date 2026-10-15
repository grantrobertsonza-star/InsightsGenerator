import { NextResponse } from "next/server";
import { withTenant } from "@/lib/db";
import {
  buildNarrativeReportDocx,
  humanizeTitle,
  safeFileStem,
  type NarrativeReportDocument,
  type NarrativeReportFinding,
  type NarrativeReportObjectiveItem,
  type NarrativeReportPillar,
  type NarrativeReportRecommendation,
} from "@/lib/docxReport";
import { loadDiscoveryReportData } from "@/lib/discoveryReport";
import { buildChartImagesByTheme } from "@/lib/exportChartImages";
import type { ChartableFinding } from "@/lib/findingsChartData";
import type { DeckPillar } from "@/lib/storyNarrative";
import { exportCaveatLabels } from "@/lib/caveatLabels";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

type ConfidenceTier = "strong" | "moderate" | "exploratory" | null;
type QualityTier = "finding" | "partial" | "qualified" | null;

/** Local to this route: the row shape the SQL query above actually returns, before
 * caveat_tags is narrowed down to NarrativeReportRecommendation['caveats'] (humanised,
 * allow-listed labels) just before the docx renderer is called. */
type RawRecommendation = Omit<NarrativeReportRecommendation, "caveats"> & {
  caveat_tags: string[] | null;
};

type PillarInsight = {
  id: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  confidence_tier: ConfidenceTier;
  quality_tier: QualityTier;
  /** FND-001/REP-OUT-001 (second counter-review): raw caveat tags aggregated, live, from every
   * still-eligible (non-rejected) finding this insight was built from. Narrowed to the short,
   * humanised, export-worthy subset via exportCaveatLabels() before this reaches docxReport.ts -
   * see caveatLabels.ts for why only a narrow allow-list of tags is exported at all. */
  caveat_tags: string[] | null;
};

/**
 * Exports the same unified, accepted-evidence-only "Insights Report" the
 * slide deck (story/export/route.ts) builds, as a narrative Word document
 * instead of a deck. The two routes deliberately share one query, below,
 * copied from the deck route rather than imported from it, so a future
 * change to one output's content doesn't silently reshape the other's --
 * see that route's own doc comment for why the evidence boundary (only
 * accepted synthesized insights and recommendations) is drawn where it is.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: runId } = await params;

  const result = await withTenant(TENANT_ID, async (client) => {
    const runResult = await client.query<{
      project_name: string | null;
      decision_statement: string | null;
      audience: string | null;
      business_problem: string | null;
      research_objective: string | null;
      entry_point: "generate" | "validate" | null;
      methodology: string | null;
    }>(
      `select project_name, decision_statement, audience, business_problem, research_objective, entry_point, methodology
       from runs where id = $1`,
      [runId],
    );

    const narrativeResult = await client.query<{
      executive_summary: string;
      situation: string;
      complication: string;
      question: string;
      governing_thought: string;
      pillars: DeckPillar[];
      recommendations_intro: string;
      caveats: string[];
      generated_at: string;
    }>(
      `select executive_summary, situation, complication, question, governing_thought, pillars,
              recommendations_intro, caveats, generated_at
       from deck_narratives where run_id = $1`,
      [runId],
    );

    const narrative = narrativeResult.rows[0];
    const insightIds = narrative
      ? Array.from(
          new Set(narrative.pillars.flatMap((pillar) => pillar.insight_ids)),
        )
      : [];

    // FND-001 / REP-OUT-001: a synthesized insight (or any pre-insight it draws on) can be
    // rejected, or its own finding rejected, AFTER this run's narrative was last generated -
    // `deck_narratives.pillars[].insight_ids` is a point-in-time snapshot of ids, not a live
    // reference. Without `si.review_status = 'accepted'` and `si.run_id = $2` here, a now-
    // rejected insight (or one belonging to a different run entirely) still rendered in every
    // export of a narrative that referenced it before the rejection. The `not exists` clause
    // closes the same gap one layer further down: an insight that is itself still "accepted"
    // but was built from a pre-insight whose underlying finding has SINCE been rejected is
    // excluded too, rather than only checking the insight's own status.
    const insightsResult =
      insightIds.length > 0
        ? await client.query<PillarInsight>(
            `select si.id, si.headline, si.observation, si.tension, si.implication, si.confidence_tier, si.quality_tier,
                    (
                      select coalesce(jsonb_agg(distinct tag), '[]'::jsonb)
                      from synthesized_insight_sources s2
                      join insights i2 on i2.id = s2.pre_insight_id
                      join findings f2 on f2.id = i2.finding_id
                      cross join lateral jsonb_array_elements_text(coalesce(f2.stated_stats->'caveats', '[]'::jsonb)) as tag
                      where s2.synthesized_insight_id = si.id and f2.status <> 'rejected'
                    ) as caveat_tags
             from synthesized_insights si
             where si.id = any($1::uuid[])
               and si.run_id = $2
               and si.review_status = 'accepted'
               -- FND-001/REP-OUT-001 (second counter-review): replaces the old 'not exists
               -- (... f.status = rejected)' check. That check could only ever see a source row
               -- that STILL EXISTS - but synthesized_insight_sources.pre_insight_id and
               -- insights.claim_id (the finding link) both cascade on delete (0027/0005), so a hard
               -- deletion (deleteDocument removing a document's findings outright, or a
               -- regenerate/reprocess pass that deletes and re-creates findings with new ids -
               -- 0021_finding_history.sql) makes the join row vanish with no status to find at all,
               -- not rejected. triangulation_count (insightSynthesizer.ts) is the exact number of
               -- sources this insight was built from, persisted once and never updated - comparing
               -- the LIVE count of still-linked, non-rejected sources against it catches a rejected
               -- source (excluded by status, same as before) AND a deleted/regenerated one (simply
               -- missing from the join, so the count itself comes up short) in one measure, with no
               -- new column or migration needed.
               and (
                 select count(*) from synthesized_insight_sources s
                 join insights i on i.id = s.pre_insight_id
                 join findings f on f.id = i.finding_id
                 where s.synthesized_insight_id = si.id and f.status <> 'rejected'
               ) >= si.triangulation_count`,
            [insightIds, runId],
          )
        : null;

    // Same freshness contract as insightsResult above, applied to recommendations: a
    // recommendation can stay "accepted" while the synthesized insight it is anchored to has
    // since been rejected (or had a dependent finding rejected) - neither was checked before,
    // only the recommendation's own status.
    const recommendationsResult =
      await client.query<RawRecommendation>(
        `select r.action_text, r.owner_role, r.timeline, r.metric, r.priority,
              (
                select coalesce(jsonb_agg(distinct tag), '[]'::jsonb)
                from synthesized_insight_sources s2
                join insights i2 on i2.id = s2.pre_insight_id
                join findings f2 on f2.id = i2.finding_id
                cross join lateral jsonb_array_elements_text(coalesce(f2.stated_stats->'caveats', '[]'::jsonb)) as tag
                where s2.synthesized_insight_id = si.id and f2.status <> 'rejected'
              ) as caveat_tags
       from recommendations r
       join synthesized_insights si on si.id = r.synthesized_insight_id
       where r.run_id = $1 and r.status = 'accepted' and r.synthesized_insight_id is not null
         and si.review_status = 'accepted'
         -- FND-001/REP-OUT-001 (second counter-review): same live-count-vs-triangulation_count
         -- comparison as insightsResult above - see its comment for why a bare 'not exists
         -- (... rejected)' check cannot see a source whose link row was removed by cascading
         -- deletion rather than marked rejected.
         and (
           select count(*) from synthesized_insight_sources s
           join insights i on i.id = s.pre_insight_id
           join findings f on f.id = i.finding_id
           where s.synthesized_insight_id = si.id and f.status <> 'rejected'
         ) >= si.triangulation_count
       order by case r.priority when 'high' then 0 when 'medium' then 1 else 2 end, r.created_at`,
        [runId],
      );

    // OBJ-REV-012: evidence_digest_degraded (migration 0087) is migration-guarded with a catalog
    // probe, same technique and same reasoning as page.tsx's own getObjectiveValidations - a
    // failed SELECT on a pre-migration database would abort the rest of this transaction. Both
    // export routes used to omit this column entirely, so a degraded conclusion (generated while
    // direct data-evidence retrieval was failing) reached DOCX/PPTX with no qualification at all,
    // even though the live app already flags it. Folded into the same `conclusion` string the
    // existing "inferred" wrapper already builds, rather than a new field, so every renderer that
    // already prints `conclusion` picks this up with no further change.
    const evidenceDigestDegradedColExists = await client.query<{ exists: boolean }>(
      `select exists (
         select 1 from information_schema.columns
         where table_name = 'objective_validations' and column_name = 'evidence_digest_degraded'
       ) as "exists"`,
    );
    const objectiveValidationsResult = evidenceDigestDegradedColExists.rows[0]?.exists === true
      ? await client.query<NarrativeReportObjectiveItem>(
          `select item_kind, item_text,
                case when inferred then 'inferred' else status end as status,
                (case when inferred then 'Inferred from this project''s own evidence, not an independent test. ' || conclusion else conclusion end)
                  || (case when evidence_digest_degraded then ' (Evidence check degraded: generated while data-evidence retrieval was failing - may be missing evidence a working check would have cited.)' else '' end) as conclusion
         from objective_validations
         where run_id = $1
         order by item_kind, item_order`,
          [runId],
        )
      : await client.query<NarrativeReportObjectiveItem>(
          `select item_kind, item_text,
                case when inferred then 'inferred' else status end as status,
                case when inferred then 'Inferred from this project''s own evidence, not an independent test. ' || conclusion else conclusion end as conclusion
         from objective_validations
         where run_id = $1
         order by item_kind, item_order`,
          [runId],
        );

    const unmappedInsightsResult = await client.query<{ headline: string }>(
      `select si.headline
       from synthesized_insights si
       where si.run_id = $1 and si.review_status = 'accepted'
         and not exists (
           select 1 from objective_validations ov
           where ov.run_id = $1 and ov.inferred = false and si.id = any(ov.synthesized_insight_ids)
         )
         and exists (select 1 from objective_validations x where x.run_id = $1 and x.inferred = false)`,
      [runId],
    );

    // Methodology section: the source documents this project actually
    // processed, kind by kind, so the report states what it draws on
    // rather than leaving that implicit.
    const documentsResult = await client.query<NarrativeReportDocument>(
      `select kind, source_filename from documents where run_id = $1 order by kind, uploaded_at`,
      [runId],
    );

    // Findings section: the same accepted-evidence boundary as everything
    // else on this report, restricted further to findings that actually
    // passed verification (robust or use_with_caution), matching exactly
    // what was eligible to become an insight in the first place -- a
    // finding that didn't clear that bar has no business appearing in a
    // client-facing report as though it were established.
    // Selects the same accepted-and-verified columns docxReport.ts's text
    // bullets always needed, plus the columns findingsChartData.ts needs to
    // tell whether a theme's findings are chartable (origin, pattern_type,
    // stated_stats) -- one query covers both the finding-text list and the
    // chart images built from it below, so they can never disagree about
    // which findings qualify for this report.
    const findingsResult = await client.query<
      NarrativeReportFinding & ChartableFinding
    >(
      `select f.id, f.origin, f.pattern_type, f.status, f.stated_stats,
              f.finding_text, f.theme, v.verdict_tier
       from findings f
       join verdicts v on v.finding_id = f.id
       where f.run_id = $1 and f.status = 'accepted' and v.verdict_tier in ('robust', 'use_with_caution')
       order by f.theme nulls last, f.created_at`,
      [runId],
    );

    // The validated / net-new split: what this analysis added beyond what
    // the original report said, listed separately (see discoveryReport.ts).
    const discovery = await loadDiscoveryReportData(client, runId);

    return {
      run: runResult.rows[0],
      narrative,
      insightsById: new Map(
        (insightsResult?.rows ?? []).map((row) => [row.id, row]),
      ),
      recommendations: recommendationsResult.rows.map((r) => ({
        action_text: r.action_text,
        owner_role: r.owner_role,
        timeline: r.timeline,
        metric: r.metric,
        priority: r.priority,
        caveats: exportCaveatLabels(r.caveat_tags),
      })),
      objectiveValidations: objectiveValidationsResult.rows,
      unmappedInsightHeadlines: unmappedInsightsResult.rows.map(
        (row) => row.headline,
      ),
      documents: documentsResult.rows,
      findings: findingsResult.rows,
      discovery,
    };
  });

  const {
    run,
    narrative,
    insightsById,
    recommendations,
    objectiveValidations,
    unmappedInsightHeadlines,
    documents,
    findings,
    discovery,
  } = result;

  if (!run) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!narrative) {
    return NextResponse.json(
      {
        error:
          "No Insights Report has been generated for this project yet. Generate it in the app first.",
      },
      { status: 404 },
    );
  }

  // REP-OUT-001: track what the eligibility filter in insightsResult's own query actually
  // left out, rather than silently dropping an unresolved id - see NarrativeReportPillar's own
  // field comment for why this is surfaced to the reader instead of just shrinking the pillar.
  let anyPillarStale = false;
  const pillars: NarrativeReportPillar[] = narrative.pillars.map((pillar) => {
    const resolved = pillar.insight_ids
      .map((id) => insightsById.get(id))
      .filter((insight): insight is PillarInsight => Boolean(insight));
    const omittedInsightCount = pillar.insight_ids.length - resolved.length;
    if (omittedInsightCount > 0) anyPillarStale = true;
    return {
      headline: pillar.headline,
      so_what: pillar.so_what,
      insights: resolved.map((insight) => ({
        headline: insight.headline,
        observation: insight.observation,
        implication: insight.implication,
        caveats: exportCaveatLabels(insight.caveat_tags),
      })),
      omittedInsightCount,
    };
  });

  const deckTitle = humanizeTitle(
    run.project_name ?? run.decision_statement ?? "Insights Elevator",
  );

  // Rendered server-side (see renderChartImage.ts) from the same findings
  // that feed the text bullets below -- a theme whose findings are all
  // code-computed banner comparisons gets a chart image; everything else
  // (report-sourced findings, or a theme mixing the two) stays text-only,
  // same eligibility rule as the Findings page's Chart findings tab.
  const chartImagesByTheme = await buildChartImagesByTheme(findings, 640);

  const buffer = await buildNarrativeReportDocx({
    title: deckTitle,
    narrativeMayBeStale: anyPillarStale,
    decisionStatement: narrative.question || run.decision_statement,
    audience: run.audience,
    businessProblem: run.business_problem,
    researchObjective: run.research_objective,
    entryPoint: run.entry_point,
    methodology: run.methodology,
    executiveSummary: narrative.executive_summary,
    situation: narrative.situation,
    complication: narrative.complication,
    question: narrative.question,
    governingThought: narrative.governing_thought,
    documents,
    findings,
    chartImagesByTheme,
    objectiveItems: objectiveValidations,
    unmappedInsightHeadlines,
    pillars,
    recommendationsIntro: narrative.recommendations_intro,
    recommendations,
    caveats: narrative.caveats,
    generatedAt: narrative.generated_at,
    discovery,
  });

  const safeName = safeFileStem(
    run.project_name ?? run.decision_statement,
    "insights-report",
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${safeName}-insights-report.docx"`,
    },
  });
}
