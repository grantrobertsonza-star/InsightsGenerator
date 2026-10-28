import { narrativeFreshnessNote } from "@/lib/narrativeFreshness";
import { insightsNoItemCites, loadObjectiveCoverage, qualifiedConclusion } from "@/lib/objectiveCoverage";
import { NextResponse } from "next/server";
import { withTenant, withTenantRead } from "@/lib/db";
import { loadEvidenceTrail, loadTrailContext, unreadableTrail, type EvidenceTrail } from "@/lib/evidenceTrail";
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
import { applySupportToDiscovery, discoveryInsightIds, loadDiscoveryReportData } from "@/lib/discoveryReport";
import { narrativeFramingQualification } from "@/lib/narrativeSupportSummary";
import { buildChartImagesByTheme } from "@/lib/exportChartImages";
import type { ChartableFinding } from "@/lib/findingsChartData";
import type { DeckPillar } from "@/lib/storyNarrative";
import { exportCaveatLabels } from "@/lib/caveatLabels";
import { loadInsightSupportOrUnchecked } from "@/lib/supportStatus";
import { summariseSupport, type InsightSupport } from "@/lib/supportStatusShared";
import { figureCheckLoadErrorNote, joinNotes, loadRunFigureChecksForExport } from "@/lib/figureChecks";
import { figureCheckNote } from "@/lib/numberTrace";
import { latestVerdictLateral } from "@/lib/latestVerdict";
import { routeRequestContext } from "@/lib/requestContext";
import { latestMethodologyFailure } from "@/lib/methodologyStatus";

type ConfidenceTier = "strong" | "moderate" | "exploratory" | null;
type QualityTier = "finding" | "partial" | "qualified" | null;

/** Local to this route: the row shape the SQL query above actually returns, before
 * caveat_tags is narrowed down to NarrativeReportRecommendation['caveats'] (humanised,
 * allow-listed labels) just before the docx renderer is called. */
type RawRecommendation = Omit<NarrativeReportRecommendation, "caveats" | "supportNote"> & {
  id: string;
  caveat_tags: string[] | null;
  /** FND-001: the anchor insight, whose support status the recommendation inherits. */
  synthesized_insight_id: string;
  synthesized_insight_headline: string;
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
  const context = await routeRequestContext();
  if (context instanceof Response) return context;
  const TENANT_ID = context.tenantId;
  const { id: runId } = await params;

  // B39-F01: coverage reads its cited insights' support on its own connections, so it is read before
  // the export's transaction rather than inside it (a connection held while waiting for another).
  const coverage = await loadObjectiveCoverage(TENANT_ID, runId);
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
    // export of a narrative that referenced it before the rejection. One layer further down
    // (a source finding rejected, deleted, edited in place or recalculated since the insight was
    // drafted) is decided by the shared support check applied after this transaction.
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
               and si.review_status = 'accepted'`,
            // FND-001 (this repair): the Brief 35 live-count comparison that used to sit here is
            // replaced by the shared support check (supportStatus.ts) applied after this query,
            // which covers the same rejection/deletion cases AND in-place edits, recalculation and
            // uncheckable support, and reports WHY an insight was left out instead of dropping it.
            [insightIds, runId],
          )
        : null;

    // Same freshness contract as insightsResult above, applied to recommendations: a
    // recommendation can stay "accepted" while the synthesized insight it is anchored to has
    // since been rejected (or had a dependent finding rejected) - neither was checked before,
    // only the recommendation's own status.
    const recommendationsResult =
      await client.query<RawRecommendation>(
        `select r.id, r.action_text, r.owner_role, r.timeline, r.metric, r.priority,
              r.synthesized_insight_id, si.headline as synthesized_insight_headline,
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
         -- FND-001: support status is applied after this query (see insightsResult).
       order by case r.priority when 'high' then 0 when 'medium' then 1 else 2 end, r.created_at`,
        [runId],
      );

    // Coverage is read through its one owner (objectiveCoverage.ts). The inferred and degraded
    // (OBJ-REV-012) qualifications and, CE-1, an out-of-date or unknown check are folded into the
    // `conclusion` string every renderer already prints, so none of them is dropped on export.
    const objectiveValidationsResult = {
      rows: coverage.rows.map((r): NarrativeReportObjectiveItem => ({
        item_kind: r.item_kind,
        item_text: r.item_text,
        status: r.inferred ? "inferred" : r.status,
        conclusion: qualifiedConclusion(r, coverage.freshness),
        
      })),
    };
    // An accepted synthesized insight that no stated objective or decision cites: evidence the
    // project turned up that nothing it asked about points to (see objectiveValidator.ts).
    const acceptedForCoverage = await client.query<{ id: string; headline: string }>(
      "select id, headline from synthesized_insights where run_id = $1 and review_status = 'accepted' order by created_at, id",
      [runId],
    );
    const unmappedInsightsResult = { rows: insightsNoItemCites(coverage.rows, acceptedForCoverage.rows) };

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
       join ${latestVerdictLateral("f.id", ["verdict_tier"])} v on true
       where f.run_id = $1 and f.status = 'accepted' and v.verdict_tier in ('robust', 'use_with_caution')
       order by f.theme nulls last, f.created_at`,
      [runId],
    );

    // The validated / net-new split: what this analysis added beyond what
    // the original report said, listed separately (see discoveryReport.ts).
    const discovery = await loadDiscoveryReportData(client, runId);
    // CE-3: a narrative written for an earlier version of the project is qualified in the file too.
    const narrativeFreshness = narrative ? await narrativeFreshnessNote(client, runId) : null;

    return {
      run: runResult.rows[0],
      narrative,
      narrativeFreshness,
      insightsById: new Map(
        (insightsResult?.rows ?? []).map((row) => [row.id, row]),
      ),
      rawRecommendations: recommendationsResult.rows,
      objectiveValidations: objectiveValidationsResult.rows,
      unmappedInsights: unmappedInsightsResult.rows,
      documents: documentsResult.rows,
      findings: findingsResult.rows,
      discovery,
    };
  });

  const {
    run,
    narrative,
    narrativeFreshness,
    insightsById,
    rawRecommendations,
    objectiveValidations,
    unmappedInsights,
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

  // FND-001 / REP-OUT-001: one support check for every insight this export can show (pillar
  // insights, recommendation anchors and the "also surfaced" list). Invalid support (a source
  // rejected or deleted) is left out and LISTED with its reason; changed or uncheckable support
  // is kept with a visible note. A failed check marks everything "not checked" (qualified), never
  // current. Nothing is written: wording and review decisions are untouched.
  const supportIds = Array.from(
    new Set([
      ...insightsById.keys(),
      ...rawRecommendations.map((r) => r.synthesized_insight_id),
      ...unmappedInsights.map((u) => u.id),
      ...discoveryInsightIds(discovery),
    ]),
  );
  const support = await loadInsightSupportOrUnchecked(TENANT_ID, runId, supportIds);
  const noteFor = (s: InsightSupport) => summariseSupport(s) || undefined;
  // Numerical traceability (0101): an AI-written insight, recommendation or narrative whose figures
  // need review (or failed) carries that note next to its support note. A failed read of the
  // checks is said once at the top of the Insights section, never read as "all traced".
  const figures = await loadRunFigureChecksForExport((fn) => withTenant(TENANT_ID, fn), runId);
  const excludedFromReport: { kind: "insight" | "recommendation" | "contradiction"; headline: string; reason: string }[] = [];
  const excludedInsightIds = new Set<string>();

  // REP-OUT-001: track what was actually left out, rather than silently dropping an unresolved id
  // - see NarrativeReportPillar's own field comments.
  let anyPillarStale = false;
  const pillars: NarrativeReportPillar[] = narrative.pillars.map((pillar) => {
    const kept: { insight: PillarInsight; supportNote?: string }[] = [];
    const excluded: { headline: string; reason: string }[] = [];
    for (const id of pillar.insight_ids) {
      const insight = insightsById.get(id);
      if (!insight) {
        // Not accepted any more, deleted, or not in this run: the narrative's own record of it
        // is gone, so only the fact of the omission can be reported.
        excluded.push({ headline: "An insight this narrative referenced", reason: "it is no longer accepted or no longer exists" });
        continue;
      }
      const s = support.statusOf(id);
      if (s.status === "invalid") {
        const reason = summariseSupport(s);
        excluded.push({ headline: insight.headline, reason });
        if (!excludedInsightIds.has(id)) {
          excludedInsightIds.add(id);
          excludedFromReport.push({ kind: "insight", headline: insight.headline, reason });
        }
        continue;
      }
      if (s.status === "stale") anyPillarStale = true;
      kept.push({ insight, supportNote: joinNotes(noteFor(s), figureCheckNote(figures.synthesizedInsights[id])) });
    }
    if (excluded.length > 0) anyPillarStale = true;
    return {
      headline: pillar.headline,
      so_what: pillar.so_what,
      insights: kept.map(({ insight, supportNote }) => ({
        headline: insight.headline,
        observation: insight.observation,
        implication: insight.implication,
        caveats: exportCaveatLabels(insight.caveat_tags),
        ...(supportNote ? { supportNote } : {}),
      })),
      omittedInsightCount: excluded.length,
      excluded,
    };
  });

  const recommendations: NarrativeReportRecommendation[] = [];
  for (const r of rawRecommendations) {
    const s = support.statusOf(r.synthesized_insight_id);
    if (s.status === "invalid") {
      excludedFromReport.push({
        kind: "recommendation",
        headline: r.action_text,
        reason: `its insight "${r.synthesized_insight_headline}" is no longer supported (${summariseSupport(s)})`,
      });
      continue;
    }
    const supportNote = joinNotes(noteFor(s), figureCheckNote(figures.recommendations[r.id]));
    recommendations.push({
      action_text: r.action_text,
      owner_role: r.owner_role,
      timeline: r.timeline,
      metric: r.metric,
      priority: r.priority,
      caveats: exportCaveatLabels(r.caveat_tags),
      ...(supportNote ? { supportNote } : {}),
    });
  }
  // CE-5: the evidence trail of each recommendation in the report, for its appendix. Read after the
  // report's own transaction, one recommendation at a time, so one unreadable trail is stated in the
  // appendix rather than failing the whole report or silently leaving that trail out.
  const evidenceTrails: EvidenceTrail[] = [];
  // One context for every trail (B39-F01: read on its own connections, before any trail's). A failed
  // context read is stated on each trail, as one unreadable trail is.
  // EC10K-P01: the served decisions and brief passages of every trail are read once, with the context.
  const trailed = rawRecommendations.filter((r) => support.statusOf(r.synthesized_insight_id).status !== "invalid");
  const trailContext = trailed.length > 0 ? await loadTrailContext(TENANT_ID, runId, trailed.map((r) => r.id)).catch((e: unknown) => e instanceof Error ? e : new Error(String(e))) : null;
  for (const r of trailed) {
    try {
      if (trailContext instanceof Error) throw trailContext;
      evidenceTrails.push(await withTenantRead(TENANT_ID, (client) => loadEvidenceTrail(client, TENANT_ID, runId, r.id, trailContext!)));
    } catch (e) {
      evidenceTrails.push(unreadableTrail(r.action_text, e instanceof Error ? e.message : String(e)));
    }
  }
  // The "New insights beyond the report" section follows the same rule: an insight left out above
  // cannot come back there as an ordinary new insight. One the narrative does not cite is listed
  // in "Excluded from this report" too, so its omission is still disclosed.
  const discoveryApplied = applySupportToDiscovery(discovery, (id) => support.statusOf(id));
  for (const e of discoveryApplied.excluded) {
    if (e.kind === "contradiction") {
      excludedFromReport.push({ kind: "contradiction", headline: e.headline, reason: e.reason });
      continue;
    }
    if (!e.insightId || excludedInsightIds.has(e.insightId)) continue;
    excludedInsightIds.add(e.insightId);
    excludedFromReport.push({ kind: "insight", headline: e.headline, reason: e.reason });
  }
  // Saved framing is printed as generated, with this qualification beside it whenever any insight
  // it was written from no longer has current support (same counting rule as the app's line).
  const citedInsightIds = narrative.pillars.flatMap((pillar) => pillar.insight_ids);
  const supportFramingNote = narrativeFramingQualification(
    citedInsightIds,
    Object.fromEntries(citedInsightIds.filter((id) => insightsById.has(id)).map((id) => [id, support.statusOf(id)])),
  );
  const framingNote = joinNotes(narrativeFreshness, supportFramingNote) ?? null;

  // An insight whose support is no longer valid is not offered as further evidence either.
  const unmappedInsightHeadlines = unmappedInsights
    .filter((u) => support.statusOf(u.id).status !== "invalid")
    .map((u) => u.headline);

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
    ...(framingNote ? { framingNote } : {}),
    figureNote: joinNotes(figureCheckNote(figures.narrative), figureCheckLoadErrorNote(figures)),
    excludedFromReport,
    evidenceTrails,
    decisionStatement: narrative.question || run.decision_statement,
    audience: run.audience,
    businessProblem: run.business_problem,
    researchObjective: run.research_objective,
    entryPoint: run.entry_point,
    methodology: run.methodology,
    methodologyUnread: run.methodology === null && (await latestMethodologyFailure(TENANT_ID, runId)) !== null,
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
    discovery: discoveryApplied.discovery,
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
