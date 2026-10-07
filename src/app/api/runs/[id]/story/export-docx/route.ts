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

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

type ConfidenceTier = "strong" | "moderate" | "exploratory" | null;
type QualityTier = "finding" | "partial" | "qualified" | null;

type PillarInsight = {
  id: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  confidence_tier: ConfidenceTier;
  quality_tier: QualityTier;
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

    const insightsResult =
      insightIds.length > 0
        ? await client.query<PillarInsight>(
            `select si.id, si.headline, si.observation, si.tension, si.implication, si.confidence_tier, si.quality_tier
             from synthesized_insights si
             where si.id = any($1::uuid[])`,
            [insightIds],
          )
        : null;

    const recommendationsResult =
      await client.query<NarrativeReportRecommendation>(
        `select r.action_text, r.owner_role, r.timeline, r.metric, r.priority
       from recommendations r
       join synthesized_insights si on si.id = r.synthesized_insight_id
       where r.run_id = $1 and r.status = 'accepted' and r.synthesized_insight_id is not null
       order by case r.priority when 'high' then 0 when 'medium' then 1 else 2 end, r.created_at`,
        [runId],
      );

    const objectiveValidationsResult =
      await client.query<NarrativeReportObjectiveItem>(
        `select item_kind, item_text, status, conclusion
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
           where ov.run_id = $1 and si.id = any(ov.synthesized_insight_ids)
         )`,
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
      recommendations: recommendationsResult.rows,
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

  const pillars: NarrativeReportPillar[] = narrative.pillars.map((pillar) => ({
    headline: pillar.headline,
    so_what: pillar.so_what,
    insights: pillar.insight_ids
      .map((id) => insightsById.get(id))
      .filter((insight): insight is PillarInsight => Boolean(insight))
      .map((insight) => ({
        headline: insight.headline,
        observation: insight.observation,
        implication: insight.implication,
      })),
  }));

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
