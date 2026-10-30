import { narrativeFreshnessNote } from "@/lib/narrativeFreshness";
import { insightsNoItemCites, loadObjectiveCoverage, qualifiedConclusion } from "@/lib/objectiveCoverage";
import { NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";
import { withTenant, withTenantRead } from "@/lib/db";
import { loadEvidenceTrail, loadTrailContext, unreadableTrail, type EvidenceTrail } from "@/lib/evidenceTrail";
import { addEvidenceTrailSlides } from "@/lib/evidenceTrailSlides";
import {
  addTitleSlide,
  addFooter,
  addLabeledTextSlide,
  addBigStatementSlide,
  addSectionDivider,
  addEvidenceCard,
  addChartSlide,
  confidenceBadgeFor,
  PRIORITY_BADGES,
  VALIDATION_BADGES,
  COLORS,
  FONT,
  CARD_LAYOUT,
  safeFileStem,
  humanizeTitle,
  fitParagraph,
  fitBulletList,
  addArgumentMapSlide,
  addDeckRoadmapSlide,
  addVisualSCQASlide,
  addQualificationBand,
} from "@/lib/deckSlides";
import { exportCaveatLabels } from "@/lib/caveatLabels";
import { loadInsightSupportOrUnchecked } from "@/lib/supportStatus";
import { loadSynthesizedInsightSources, sourceLine } from "@/lib/sourceAttribution";
import { summariseSupport, type InsightSupport, type SupportStatus } from "@/lib/supportStatusShared";
import { figureCheckLoadErrorNote, joinNotes, loadRunFigureChecksForExport } from "@/lib/figureChecks";
import { figureCheckNote } from "@/lib/numberTrace";
import type { DeckPillar } from "@/lib/storyNarrative";
import { addDiscoverySlides } from "@/lib/discoverySlides";
import { applySupportToDiscovery, discoveryInsightIds, loadDiscoveryReportData } from "@/lib/discoveryReport";
import { narrativeFramingQualification } from "@/lib/narrativeSupportSummary";
import { buildChartImagesByTheme } from "@/lib/exportChartImages";
import type { ChartableFinding } from "@/lib/findingsChartData";
import { latestVerdictLateral } from "@/lib/latestVerdict";
import { routeRequestContext, runBelongsToTenant } from "@/lib/requestContext";

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
  /** FND-001/REP-OUT-001 (second counter-review): raw caveat tags aggregated, live, from every
   * still-eligible (non-rejected) finding this insight was built from - see caveatLabels.ts for
   * why only a narrow allow-list is ever exported. Not rendered inline on the fixed-height
   * evidence card (addEvidenceCard is tuned for exactly three lines - see INSIGHT_ROW's own
   * comment on why a third line already needed a height increase); surfaced instead on a
   * dedicated "EVIDENCE QUALIFICATIONS" slide below. */
  caveat_tags: string[] | null;
};

type ExportRecommendation = {
  action_text: string;
  owner_role: string;
  timeline: string;
  metric: string;
  priority: "high" | "medium" | "low";
  /** Same meaning as PillarInsight['caveat_tags'] above, aggregated via the insight this
   * recommendation is anchored to (recommendations.synthesized_insight_id). */
  caveat_tags: string[] | null;
  /** FND-001: the anchor insight, whose support status the recommendation inherits. */
  synthesized_insight_id: string;
  synthesized_insight_headline: string;
  id: string;
};

/** FND-001: the support status shown, in words, on an evidence card's badge strip (never colour
 * alone). A current insight's badge is unchanged. Invalid support never reaches a card - it is
 * excluded and listed on the "Evidence status" slide. */
const SUPPORT_BADGE_SUFFIX: Record<SupportStatus, string> = {
  current: "",
  stale: "SUPPORT CHANGED",
  unknown: "SUPPORT NOT CHECKED",
  invalid: "SUPPORT NO LONGER VALID",
};
function withSupportBadge<B extends { glyph: string; label: string; color: string }>(badge: B, status: SupportStatus): B {
  const suffix = SUPPORT_BADGE_SUFFIX[status];
  return suffix ? { ...badge, label: `${badge.label} · ${suffix}` } : badge;
}

type ExportObjectiveValidation = {
  item_kind: "objective" | "decision";
  item_text: string;
  status: "resolved" | "partial" | "gap" | "inferred";
  conclusion: string;
  synthesized_insight_ids: string[];
};

// Objective/decision cards are two lines (the item itself, then its
// conclusion), but item_text and conclusion are each capped at 40/35 words
// in objectiveValidator.ts -- long enough that most real decision
// statements and conclusions still wrap to 2-3 lines each even at this
// card's full 9in width. H=1.0 with 3 per slide left only ~0.48in for both
// lines combined, so fitLinesToBox's own character-truncation fallback was
// firing on top of the already-capped text, cutting it again mid-clause.
// Matching INSIGHT_ROW's H=1.5 / 2-per-slide gives each card the room the
// capped text actually needs without a second round of truncation.
const OBJECTIVE_ROW = {
  H: 1.5,
  GAP: 0.22,
  GRID_X: 0.5,
  GRID_Y: 1.0,
  W: 9,
  PER_SLIDE: 2,
} as const;

// PER_SLIDE is 2, not 3: at H=1.5 (the height a three-line evidence card
// actually needs to stay readable), three stacked cards plus their gaps
// run past the bottom of a 5.625in LAYOUT_16x9 slide and the third card
// gets clipped by the footer. Two per slide, with a little more breathing
// room between them, is what actually fits.
const INSIGHT_ROW = {
  H: 1.5,
  GAP: 0.22,
  GRID_X: 0.5,
  GRID_Y: 1.85,
  W: 9,
  PER_SLIDE: 2,
} as const;

/**
 * Exports the unified, client-ready "Insights Report" deck: the single
 * narrative-driven story this project's accepted evidence adds up to,
 * built from the deck_narratives row a prior call to
 * generateStoryNarrative (src/lib/storyNarrative.ts) produced.
 *
 * The narrative row only carries the framing (executive summary,
 * situation/complication/question/governing thought, and which synthesized
 * insight ids belong to each pillar). Every piece of evidence text actually
 * printed on a slide -- insight headlines, observations, tensions,
 * implications, and the recommendation list -- is pulled fresh from the
 * database by id here, never taken from anything the model wrote: the same
 * "the application, never the model" principle the rest of this pipeline
 * follows for anything that must stay exactly what a researcher reviewed
 * and accepted.
 *
 * Built on the synthesized-insight layer, the same funnel output the
 * Recommendations and Synthesized insights sections of the app use, so the
 * deck's evidence base and the app's own review screens never disagree
 * about what "the insights" are.
 *
 * Visual design lives in src/lib/deckSlides.ts (the shared palette, the
 * dot-cluster motif, and the evidence-card primitive); this route is
 * responsible only for the content and the slide sequence, so a future
 * client-branded palette only means changing deckSlides.ts.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const context = await routeRequestContext();
  if (context instanceof Response) return context;
  const TENANT_ID = context.tenantId;
  const { id: runId } = await params;
  // SEC1: another organisation's project answers exactly like a missing one, before anything is read.
  if (!(await runBelongsToTenant(TENANT_ID, runId))) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // B39-F01: coverage reads its cited insights' support on its own connections, so it is read before
  // the export's transaction rather than inside it (a connection held while waiting for another).
  const coverage = await loadObjectiveCoverage(TENANT_ID, runId);
  const result = await withTenant(TENANT_ID, async (client) => {
    const runResult = await client.query<{
      project_name: string | null;
      decision_statement: string | null;
      audience: string | null;
    }>(
      "select project_name, decision_statement, audience from runs where id = $1 and tenant_id = $2",
      [runId, TENANT_ID],
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
    // export of a narrative that referenced it before the rejection. One layer further down (a
    // source finding rejected, deleted, edited in place or recalculated since the insight was
    // drafted) is decided by the shared support check applied after this transaction. Kept identical to, but
    // not imported from, export-docx/route.ts's own copy - same reasoning as this file's own
    // doc comment on why the two routes share a query by copy, not by import.
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
            // FND-001 (this repair): the Brief 35 live-count comparison that sat here is replaced by
            // the shared support check (supportStatus.ts) applied after this transaction - same
            // rejection/deletion coverage, plus in-place edits, recalculation and uncheckable support,
            // with a visible reason instead of a silent drop.
            [insightIds, runId],
          )
        : null;

    // Same freshness contract as insightsResult above, applied to recommendations: a
    // recommendation can stay "accepted" while the synthesized insight it is anchored to has
    // since been rejected (or had a dependent finding rejected) - neither was checked before,
    // only the recommendation's own status.
    const recommendationsResult = await client.query<ExportRecommendation>(
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
         -- FND-001: support status is applied after this transaction (see insightsResult).
       order by case r.priority when 'high' then 0 when 'medium' then 1 else 2 end, r.created_at`,
      [runId],
    );

    // Coverage is read through its one owner (objectiveCoverage.ts). The inferred and degraded
    // (OBJ-REV-012) qualifications and, CE-1, an out-of-date or unknown check are folded into the
    // `conclusion` string every renderer already prints, so none of them is dropped on export.
    const objectiveValidationsResult = {
      rows: coverage.rows.map((r): ExportObjectiveValidation => ({
        item_kind: r.item_kind,
        item_text: r.item_text,
        status: r.inferred ? "inferred" : r.status,
        conclusion: qualifiedConclusion(r, coverage.freshness),
        synthesized_insight_ids: r.synthesized_insight_ids,
      })),
    };
    // An accepted synthesized insight that no stated objective or decision cites: evidence the
    // project turned up that nothing it asked about points to (see objectiveValidator.ts).
    const acceptedForCoverage = await client.query<{ id: string; headline: string }>(
      "select id, headline from synthesized_insights where run_id = $1 and review_status = 'accepted' order by created_at, id",
      [runId],
    );
    const unmappedInsightsResult = { rows: insightsNoItemCites(coverage.rows, acceptedForCoverage.rows) };

    // Same accepted-and-verified scope and chartability columns the docx
    // export's Findings section uses (see story/export-docx/route.ts) --
    // the deck's "Evidence charts" section below is built from the exact
    // same theme-eligible charts, so the two exports never disagree about
    // which themes got a chart.
    const findingsResult = await client.query<ChartableFinding>(
      `select f.id, f.origin, f.pattern_type, f.status, f.stated_stats, f.theme
       from findings f
       join ${latestVerdictLateral("f.id", ["verdict_tier"])} v on true
       where f.run_id = $1 and f.status = 'accepted' and v.verdict_tier in ('robust', 'use_with_caution')
       order by f.theme nulls last, f.created_at`,
      [runId],
    );

    // The validated / net-new split (see discoveryReport.ts): what this
    // analysis added beyond what the original report said.
    const discovery = await loadDiscoveryReportData(client, runId);
    // CE-3: a narrative written for an earlier version of the project is qualified in the file too.
    const narrativeFreshness = narrative ? await narrativeFreshnessNote(client, runId) : null;

    return {
      run: runResult.rows[0],
      narrative,
      narrativeFreshness,
      acceptedInsightsById: new Map(
        (insightsResult?.rows ?? []).map((row) => [row.id, row]),
      ),
      acceptedRecommendations: recommendationsResult.rows,
      objectiveValidations: objectiveValidationsResult.rows,
      unmappedInsights: unmappedInsightsResult.rows,
      findings: findingsResult.rows,
      discovery,
    };
  });

  const {
    run,
    narrative,
    narrativeFreshness,
    acceptedInsightsById,
    acceptedRecommendations,
    objectiveValidations,
    unmappedInsights,
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

  // FND-001 / REP-OUT-001: one support check for every insight this deck can show. Invalid support
  // (a source rejected or deleted) is left out and listed on the "Evidence status" slide; changed
  // or uncheckable support stays, with the status in words on the card's badge and its reason on
  // that slide. A failed check marks everything "not checked" (qualified), never current. Read-only:
  // wording and review decisions are untouched.
  const support = await loadInsightSupportOrUnchecked(
    TENANT_ID,
    runId,
    Array.from(
      new Set([
        ...acceptedInsightsById.keys(),
        ...acceptedRecommendations.map((r) => r.synthesized_insight_id),
        ...unmappedInsights.map((u) => u.id),
        ...discoveryInsightIds(discovery),
      ]),
    ),
  );
  const supportOf = (id: string): InsightSupport => support.statusOf(id);
  // Golden-thread repair: each insight card names the sources its evidence came from.
  const sourcesByInsight = await withTenant(TENANT_ID, (client) =>
    loadSynthesizedInsightSources(client, Array.from(acceptedInsightsById.keys())),
  );
  const insightsById = new Map(
    Array.from(acceptedInsightsById).filter(([id]) => supportOf(id).status !== "invalid"),
  );
  const excludedLines: string[] = [];
  const qualifiedLines = new Map<string, string[]>();
  const noteQualified = (headline: string, s: InsightSupport) => {
    if (s.status !== "stale" && s.status !== "unknown") return;
    const summary = summariseSupport(s);
    const list = qualifiedLines.get(summary) ?? [];
    list.push(headline);
    qualifiedLines.set(summary, list);
  };
  const excludedInsightIds = new Set<string>();
  for (const [id, insight] of acceptedInsightsById) {
    const s = supportOf(id);
    if (s.status === "invalid") {
      excludedInsightIds.add(id);
      excludedLines.push(`Insight left out: ${insight.headline}. ${summariseSupport(s)}`);
    } else noteQualified(insight.headline, s);
  }
  // The "new beyond the report" slides follow the same rule: an insight left out above cannot come
  // back there as an ordinary new insight. One the narrative does not cite is listed here too.
  const discoveryApplied = applySupportToDiscovery(discovery, supportOf);
  for (const e of discoveryApplied.excluded) {
    if (e.kind === "contradiction") {
      excludedLines.push(`Contradiction left out: ${e.headline}; ${e.reason}.`);
      continue;
    }
    if (!e.insightId || excludedInsightIds.has(e.insightId)) continue;
    excludedInsightIds.add(e.insightId);
    excludedLines.push(`Insight left out: ${e.headline}. ${e.reason}`);
  }
  // Saved framing (executive summary, governing thought, SCQA answer, argument map) is shown as it
  // was generated, with this qualification on each of those slides whenever any insight it was
  // written from no longer has current support. Same counting rule as the app's support line.
  const citedInsightIds = narrative.pillars.flatMap((pillar) => pillar.insight_ids);
  const supportFramingNote = narrativeFramingQualification(
    citedInsightIds,
    Object.fromEntries(citedInsightIds.filter((id) => acceptedInsightsById.has(id)).map((id) => [id, supportOf(id)])),
  );
  const framingNote = joinNotes(narrativeFreshness, supportFramingNote) ?? null;
  const recommendations = acceptedRecommendations.filter((rec) => {
    const s = supportOf(rec.synthesized_insight_id);
    if (s.status === "invalid") {
      excludedLines.push(
        `Recommendation left out: ${rec.action_text}. Its insight "${rec.synthesized_insight_headline}" is no longer supported.`,
      );
      return false;
    }
    noteQualified(rec.action_text, s);
    return true;
  });
  const unmappedInsightHeadlines = unmappedInsights
    .filter((u) => supportOf(u.id).status !== "invalid")
    .map((u) => u.headline);
  // An id the narrative referenced that is no longer accepted (or no longer exists) has no
  // headline left to report; it is still counted per pillar below.
  const unresolvedReferenceCount = narrative.pillars
    .flatMap((pillar) => pillar.insight_ids)
    .filter((id) => !acceptedInsightsById.has(id)).length;

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  // project_name is often an internal slug a researcher typed while setting
  // the project up (e.g. "ValidateExisting"), never meant for a client to
  // see verbatim on the cover and every footer -- humanizeTitle only
  // touches unspaced slugs, so a real decision-statement-based title passes
  // through unchanged.
  const deckTitle = humanizeTitle(
    run.project_name ?? run.decision_statement ?? "Insights Elevator",
  );

  addTitleSlide(pptx, {
    title: deckTitle,
    decisionStatement: narrative.question || run.decision_statement,
    showDecisionLine: true,
    audience: run.audience,
  });

  // The deck's own table of contents, shown before a single finding: a
  // reader sees the whole shape of the report -- how it gets from
  // situation to recommendation -- before the first section starts.
  // Distinct from addArgumentMapSlide below, which maps the governing
  // thought onto its supporting pillars one level deeper, right before the
  // pillar slides themselves; this is the top-level roadmap.
  const roadmapSlide = addDeckRoadmapSlide(pptx, {
    hasObjectives: objectiveValidations.length > 0,
  });
  addFooter(roadmapSlide, deckTitle, "Deck roadmap");

  // The "page one" a consulting deck leads with: a reader who only sees
  // this slide still walks away with the governing thought and the
  // headline action, before the SCQA build-up that follows justifies it.
  if (narrative.executive_summary) {
    const summarySlide = addLabeledTextSlide(pptx, {
      label: "Executive summary",
      body: narrative.executive_summary,
    });
    if (framingNote) addQualificationBand(summarySlide, framingNote);
    addFooter(summarySlide, deckTitle, "Executive summary");
  }

  // A visual SCQA (Situation-Complication-Question-Answer / Pyramid
  // Principle) overview before the detailed build-up: the reader sees the
  // shape of the argument at a glance -- same role the plain-text divider
  // this replaced played, but as the visual conceptual slide a consulting
  // deck actually leads with, not a single preview sentence.
  const scqaSlide = addVisualSCQASlide(pptx, {
    situation: narrative.situation,
    complication: narrative.complication,
    question: narrative.question,
    answer: narrative.governing_thought,
  });
  if (framingNote) addQualificationBand(scqaSlide, framingNote);
  addFooter(scqaSlide, deckTitle, "SCQA");

  const situationSlide = addLabeledTextSlide(pptx, {
    label: "Situation",
    body: narrative.situation,
  });
  addFooter(situationSlide, deckTitle, "Situation");

  const complicationSlide = addLabeledTextSlide(pptx, {
    label: "Complication",
    body: narrative.complication,
    labelColor: COLORS.high,
  });
  addFooter(complicationSlide, deckTitle, "Complication");

  const apexSlide = addBigStatementSlide(pptx, {
    eyebrow: "What this means",
    statement: narrative.governing_thought,
    subtext: narrative.question,
  });
  if (framingNote) addQualificationBand(apexSlide, framingNote, "top");
  addFooter(apexSlide, deckTitle, "Governing thought");

  // Standard market-research reporting practice: every research objective
  // and confirmed decision gets an explicit disposition against the
  // evidence, resolved, partially answered, or named as a gap, rather than
  // the reader having to infer from the pillars whether what the project
  // set out to answer actually got answered. Only renders once the
  // objective/decision validator has actually run for this project (see
  // src/lib/objectiveValidator.ts); an older report generated before this
  // existed, or a project with no recorded objective or decision, simply
  // skips straight to the evidence pillars.
  if (objectiveValidations.length > 0) {
    addSectionDivider(pptx, {
      eyebrow: "What this means for what you asked",
      title: "Checked against the project's own objectives and decisions.",
    });

    const pageCount = Math.max(
      1,
      Math.ceil(objectiveValidations.length / OBJECTIVE_ROW.PER_SLIDE),
    );
    for (let page = 0; page < pageCount; page++) {
      const slide = pptx.addSlide();
      slide.background = { color: COLORS.paper };
      const pageItems = objectiveValidations.slice(
        page * OBJECTIVE_ROW.PER_SLIDE,
        (page + 1) * OBJECTIVE_ROW.PER_SLIDE,
      );

      slide.addText(
        pageCount > 1
          ? `OBJECTIVES & DECISIONS · PAGE ${page + 1}/${pageCount}`
          : "OBJECTIVES & DECISIONS",
        {
          x: 0.5,
          y: 0.4,
          w: 9,
          h: 0.4,
          fontSize: 13,
          bold: true,
          fontFace: FONT.body,
          color: COLORS.accent,
          charSpacing: 2,
        },
      );

      pageItems.forEach((item, rowIndex) => {
        const y =
          OBJECTIVE_ROW.GRID_Y +
          rowIndex * (OBJECTIVE_ROW.H + OBJECTIVE_ROW.GAP);
        addEvidenceCard(slide, {
          x: OBJECTIVE_ROW.GRID_X,
          y,
          w: OBJECTIVE_ROW.W,
          h: OBJECTIVE_ROW.H,
          badge: VALIDATION_BADGES[item.status],
          lines: [
            {
              text: `${item.item_kind === "objective" ? "Objective" : "Decision"}: ${item.item_text}`,
              fontSize: 12.5,
              bold: true,
            },
            { text: item.conclusion, fontSize: 10.5, color: COLORS.body },
          ],
        });
      });

      addFooter(
        slide,
        deckTitle,
        `Objectives & decisions · ${page + 1}/${pageCount}`,
      );
    }

    // The reverse case: evidence the project turned up that none of its
    // stated objectives or decisions pointed toward. A legitimate finding
    // worth naming, not something to quietly fold into a pillar as if it
    // always belonged to the brief.
    if (unmappedInsightHeadlines.length > 0) {
      const beyondSlide = addLabeledTextSlide(pptx, {
        label: "Beyond the original brief",
        body:
          `The evidence also surfaced ${unmappedInsightHeadlines.length} accepted insight` +
          `${unmappedInsightHeadlines.length === 1 ? "" : "s"} that none of the objectives or decisions above ` +
          `asked about: ${unmappedInsightHeadlines.slice(0, 4).join("; ")}` +
          `${unmappedInsightHeadlines.length > 4 ? `, and ${unmappedInsightHeadlines.length - 4} more` : ""}.`,
        labelColor: COLORS.teal,
      });
      addFooter(beyondSlide, deckTitle, "Beyond the original brief");
    }
  }

  // Evidence charts: one slide per theme whose findings are all code-computed
  // banner comparisons with the structured stats to chart (see
  // findingsChartData.ts) -- the same eligibility rule and the same
  // server-rendered images (renderChartImage.ts) the docx export's Findings
  // section embeds, so a reader comparing the two exports sees the same
  // picture for the same theme. A project with no chartable themes (every
  // finding report-sourced, or no findings at all) simply skips this section.
  const chartImagesByTheme = await buildChartImagesByTheme(findings, 640);
  if (chartImagesByTheme.length > 0) {
    addSectionDivider(pptx, {
      eyebrow: "Evidence behind the argument",
      title: "What the underlying data shows, chart by chart.",
    });
    chartImagesByTheme.forEach((chart, index) => {
      const slide = addChartSlide(pptx, {
        eyebrow:
          chartImagesByTheme.length > 1
            ? `Evidence chart ${index + 1} of ${chartImagesByTheme.length}`
            : "Evidence chart",
        title: chart.theme,
        image: chart.image,
        caption: chart.caption,
      });
      addFooter(slide, deckTitle, `Evidence · ${chart.theme}`);
    });
  }

  // New beyond the report: the net-new half of the validated / net-new
  // split, on its own pages so a reader can tell what the original report
  // said from what this analysis added (and where it corrects the report).
  addDiscoverySlides(pptx, discoveryApplied.discovery, deckTitle);

  // The last thing the reader sees before the pillars themselves: a map of
  // how many there are and how each relates to the governing thought just
  // stated, so "PILLAR 1 OF N" isn't the first sign pillars exist at all.
  if (narrative.pillars.length > 0) {
    const mapSlide = addArgumentMapSlide(pptx, {
      governingThought: narrative.governing_thought,
      pillars: narrative.pillars.map((pillar) => ({
        headline: pillar.headline,
      })),
    });
    if (framingNote) addQualificationBand(mapSlide, framingNote);
    addFooter(mapSlide, deckTitle, "The shape of this argument");
  }

  narrative.pillars.forEach((pillar, pillarIndex) => {
    const insights = pillar.insight_ids
      .map((id) => insightsById.get(id))
      .filter((insight): insight is PillarInsight => Boolean(insight));
    // REP-OUT-001 / FND-001: an id that didn't resolve is no longer accepted, or its support is no
    // longer valid (see the support check above). Tracked here, not silently dropped, so page 0
    // of this pillar can say so, and the "Evidence status" slide says which and why.
    const omittedInsightCount = pillar.insight_ids.length - insights.length;
    const pageCount = Math.max(
      1,
      Math.ceil(insights.length / INSIGHT_ROW.PER_SLIDE),
    );

    for (let page = 0; page < pageCount; page++) {
      const slide = pptx.addSlide();
      slide.background = { color: COLORS.paper };
      const pageInsights = insights.slice(
        page * INSIGHT_ROW.PER_SLIDE,
        (page + 1) * INSIGHT_ROW.PER_SLIDE,
      );

      slide.addText(
        `PILLAR ${pillarIndex + 1} OF ${narrative.pillars.length}${pageCount > 1 ? ` · PAGE ${page + 1}/${pageCount}` : ""}`,
        {
          x: 0.6,
          y: 0.4,
          w: 8.8,
          h: 0.3,
          fontSize: 11,
          bold: true,
          fontFace: FONT.body,
          color: COLORS.accent,
          charSpacing: 1.5,
        },
      );
      const fittedHeadline = fitParagraph(pillar.headline, {
        fontSize: 19,
        widthIn: 8.8,
        heightIn: 0.55,
        minFontScale: 0.65,
      });
      slide.addText(fittedHeadline.text, {
        x: 0.6,
        y: 0.72,
        w: 8.8,
        h: 0.55,
        fontSize: fittedHeadline.fontSize,
        bold: true,
        fontFace: FONT.display,
        color: COLORS.ink,
      });
      if (page === 0 && pillar.so_what) {
        const fittedSoWhat = fitParagraph(pillar.so_what, {
          fontSize: 12,
          widthIn: 8.8,
          heightIn: 0.45,
          minFontScale: 0.7,
        });
        slide.addText(fittedSoWhat.text, {
          x: 0.6,
          y: 1.3,
          w: 8.8,
          h: 0.45,
          fontSize: fittedSoWhat.fontSize,
          italic: true,
          fontFace: FONT.body,
          color: COLORS.muted,
        });
      }
      if (page === 0 && omittedInsightCount > 0) {
        // REP-OUT-001: placed below so_what (whether or not so_what itself rendered) rather
        // than inventing a new row - same reasoning as docxReport.ts's equivalent note, kept to
        // one short italic line so it doesn't compete with the pillar's own fixed layout.
        const staleNote = `${omittedInsightCount} insight${omittedInsightCount === 1 ? "" : "s"} referenced here ${omittedInsightCount === 1 ? "is" : "are"} no longer current and ${omittedInsightCount === 1 ? "has" : "have"} been left out.`;
        const fittedStale = fitParagraph(staleNote, {
          fontSize: 11,
          widthIn: 8.8,
          heightIn: 0.35,
          minFontScale: 0.7,
        });
        slide.addText(fittedStale.text, {
          x: 0.6,
          y: pillar.so_what ? 1.72 : 1.3,
          w: 8.8,
          h: 0.35,
          fontSize: fittedStale.fontSize,
          italic: true,
          fontFace: FONT.body,
          color: COLORS.muted,
        });
      }

      pageInsights.forEach((insight, rowIndex) => {
        const y =
          INSIGHT_ROW.GRID_Y + rowIndex * (INSIGHT_ROW.H + INSIGHT_ROW.GAP);
        const badge = withSupportBadge(confidenceBadgeFor(insight.confidence_tier), supportOf(insight.id).status);

        addEvidenceCard(slide, {
          x: INSIGHT_ROW.GRID_X,
          y,
          w: INSIGHT_ROW.W,
          h: INSIGHT_ROW.H,
          badge,
          lines: [
            { text: insight.headline, fontSize: 13, bold: true },
            { text: insight.observation, fontSize: 10, color: COLORS.body },
            {
              text: `“${insight.implication}”`,
              fontSize: 9.5,
              italic: true,
              color: COLORS.muted,
            },
            { text: sourceLine(sourcesByInsight.get(insight.id) ?? []), fontSize: 8, color: COLORS.muted },
          ],
        });
      });

      addFooter(
        slide,
        deckTitle,
        `Pillar ${pillarIndex + 1} · ${page + 1}/${pageCount}`,
      );
    }
  });

  addSectionDivider(pptx, {
    eyebrow: "From evidence to action",
    title: "What the data says to do about it.",
    subtitle: narrative.recommendations_intro || undefined,
  });

  const {
    CARDS_PER_ROW,
    CARD_W,
    CARD_H,
    CARD_GAP_X,
    CARD_GAP_Y,
    GRID_X,
    GRID_Y,
  } = CARD_LAYOUT;
  const CARDS_PER_SLIDE = CARD_LAYOUT.CARDS_PER_ROW * CARD_LAYOUT.CARDS_PER_COL;
  const recPageCount = Math.max(
    1,
    Math.ceil(recommendations.length / CARDS_PER_SLIDE),
  );

  for (let page = 0; page < recPageCount; page++) {
    const slide = pptx.addSlide();
    slide.background = { color: COLORS.paper };
    const pageRecs = recommendations.slice(
      page * CARDS_PER_SLIDE,
      (page + 1) * CARDS_PER_SLIDE,
    );

    slide.addText(
      recPageCount > 1
        ? `RECOMMENDED ACTIONS · ${page + 1}/${recPageCount}`
        : "RECOMMENDED ACTIONS",
      {
        x: 0.5,
        y: 0.4,
        w: 9,
        h: 0.4,
        fontSize: 13,
        bold: true,
        fontFace: FONT.body,
        color: COLORS.accent,
        charSpacing: 2,
      },
    );

    if (recommendations.length === 0) {
      slide.addText("No recommendations have been accepted yet.", {
        x: 0.6,
        y: 2.3,
        w: 8.8,
        h: 1,
        fontSize: 16,
        fontFace: FONT.body,
        color: COLORS.body,
      });
    }

    pageRecs.forEach((rec, index) => {
      const col = index % CARDS_PER_ROW;
      const row = Math.floor(index / CARDS_PER_ROW);
      const x = GRID_X + col * (CARD_W + CARD_GAP_X);
      const y = GRID_Y + row * (CARD_H + CARD_GAP_Y);
      const badge = withSupportBadge(PRIORITY_BADGES[rec.priority], supportOf(rec.synthesized_insight_id).status);

      addEvidenceCard(slide, {
        x,
        y,
        w: CARD_W,
        h: CARD_H,
        badge,
        lines: [
          { text: rec.action_text, fontSize: 11.5, bold: true },
          {
            text: `${rec.owner_role} · ${rec.timeline}`,
            fontSize: 9.5,
            italic: true,
            color: COLORS.muted,
          },
        ],
      });
    });

    addFooter(
      slide,
      deckTitle,
      `Recommended actions · ${page + 1}/${recPageCount}`,
    );
  }

  if (narrative.caveats.length > 0) {
    const slide = pptx.addSlide();
    slide.background = { color: COLORS.ink };
    slide.addText("CAVEATS & SCOPE", {
      x: 0.6,
      y: 0.55,
      w: 8.6,
      h: 0.4,
      fontSize: 13,
      bold: true,
      fontFace: FONT.body,
      color: COLORS.accentOnDark,
      charSpacing: 2,
    });
    // Four real caveats at their full 38-word cap don't fit a 3.2in box even
    // at the old 0.65 minFontScale, so fitBulletList's own truncation
    // fallback was firing on top of the already-capped text -- the same
    // compounding-truncation shape as the objective/decision cards. The box
    // actually has 3.35in of clear room before the rule line at y=4.5
    // (text starts at y=1.15), and letting the font shrink a touch further
    // (0.6 instead of 0.65, i.e. down to 8.4pt in the worst case) is enough
    // for four full-length caveats to render completely without a cut.
    const fittedCaveats = fitBulletList(narrative.caveats, {
      fontSize: 14,
      widthIn: 8.4,
      heightIn: 3.35,
      minFontScale: 0.6,
    });
    slide.addText(
      fittedCaveats.items.map((caveat) => ({
        text: caveat,
        options: { bullet: { code: "25AA" }, breakLine: true, color: "FFFFFF" },
      })),
      {
        x: 0.7,
        y: 1.15,
        w: 8.4,
        h: 3.35,
        fontSize: fittedCaveats.fontSize,
        fontFace: FONT.body,
        valign: "top",
      },
    );
    const generatedLabel = new Date(narrative.generated_at).toLocaleDateString(
      "en-ZA",
      {
        year: "numeric",
        month: "long",
        day: "numeric",
      },
    );
    slide.addShape("rect", {
      x: 0.7,
      y: 4.5,
      w: 8.4,
      h: 0.008,
      fill: { color: COLORS.ruleOnDark },
      line: { type: "none" },
    });
    const footnoteText =
      `Based only on synthesized insights and recommendations explicitly accepted as of ${generatedLabel}. ` +
      "Confidence tier reflects how well-triangulated each insight's evidence is, not how important it is.";
    const fittedFootnote = fitParagraph(footnoteText, {
      fontSize: 10,
      widthIn: 8.4,
      heightIn: 0.6,
      minFontScale: 0.75,
    });
    slide.addText(fittedFootnote.text, {
      x: 0.7,
      y: 4.62,
      w: 8.4,
      h: 0.6,
      fontSize: fittedFootnote.fontSize,
      italic: true,
      fontFace: FONT.body,
      color: COLORS.mutedOnDark,
    });
    addFooter(slide, deckTitle, "Caveats & scope");
  }

  // FND-001/REP-OUT-001 (second counter-review): a second, independent qualification surface
  // from the model-authored "CAVEATS & SCOPE" slide above (narrative.caveats is free text the
  // narrative generator wrote, never verified evidence numbers - see deck_narratives' own
  // migration comment). This slide instead lists, per still-exported insight and recommendation,
  // the export-worthy caveat tags aggregated live from that claim's own still-eligible
  // contributing findings. Gated on its own non-empty condition so a deck with no qualifying
  // findings renders no extra slide, and never merged into the prose above - a reader must not
  // mistake "this insight is stale" (the per-pillar note above) for "this insight is current but
  // qualified" (this slide).
  // GT-009: a line here restates an insight (or a recommendation on one), so it carries that
  // insight's support status in the same words as its evidence card ("SUPPORT CHANGED", "SUPPORT
  // NOT CHECKED"); before, a stale insight appeared here with only its design caveat.
  const supportTagFor = (insightId: string) => {
    const tag = SUPPORT_BADGE_SUFFIX[supportOf(insightId).status];
    return tag ? ` [${tag}]` : "";
  };
  const insightQualifications = Array.from(insightsById.entries())
    .map(([id, insight]) => ({
      headline: `${insight.headline}${supportTagFor(id)}`,
      caveats: exportCaveatLabels(insight.caveat_tags),
    }))
    .filter((entry) => entry.caveats.length > 0);
  const recommendationQualifications = recommendations
    .map((rec) => ({
      headline: `${rec.action_text}${supportTagFor(rec.synthesized_insight_id)}`,
      caveats: exportCaveatLabels(rec.caveat_tags),
    }))
    .filter((entry) => entry.caveats.length > 0);

  if (insightQualifications.length > 0 || recommendationQualifications.length > 0) {
    const slide = pptx.addSlide();
    slide.background = { color: COLORS.ink };
    slide.addText("EVIDENCE QUALIFICATIONS", {
      x: 0.6,
      y: 0.55,
      w: 8.6,
      h: 0.4,
      fontSize: 13,
      bold: true,
      fontFace: FONT.body,
      color: COLORS.accentOnDark,
      charSpacing: 2,
    });
    const qualificationLines = [
      ...insightQualifications,
      ...recommendationQualifications,
    ].map((entry) => `${entry.headline} — ${entry.caveats.join("; ")}.`);
    const fittedQualifications = fitBulletList(qualificationLines, {
      fontSize: 13,
      widthIn: 8.4,
      heightIn: 3.6,
      minFontScale: 0.6,
    });
    slide.addText(
      fittedQualifications.items.map((line) => ({
        text: line,
        options: { bullet: { code: "25AA" }, breakLine: true, color: "FFFFFF" },
      })),
      {
        x: 0.7,
        y: 1.15,
        w: 8.4,
        h: 3.6,
        fontSize: fittedQualifications.fontSize,
        fontFace: FONT.body,
        valign: "top",
      },
    );
    addFooter(slide, deckTitle, "Evidence qualifications");
  }

  // FND-001 / REP-OUT-001: what was left out, and what is shown with changed or uncheckable
  // support, with the reason - separate from the caveats slide, because a caveat qualifies current
  // evidence while this says the evidence itself moved. Identical reasons are said once with the
  // items they apply to, so a legacy project ("drafted before support tracking") gets one line,
  // not one per insight.
  // Numerical traceability (0101): AI-written text whose figures need review is listed here too,
  // with the figures and why; a failed read of the checks is said, never read as "all traced".
  const figures = await loadRunFigureChecksForExport((fn) => withTenant(TENANT_ID, fn), runId);
  const figureLines = [
    figureCheckLoadErrorNote(figures),
    figureCheckNote(figures.narrative) ? `Report narrative. ${figureCheckNote(figures.narrative)}` : null,
    ...Array.from(insightsById).map(([id, insight]) => {
      const note = figureCheckNote(figures.synthesizedInsights[id]);
      return note ? `${insight.headline}. ${note}` : null;
    }),
    ...recommendations.map((rec) => {
      const note = figureCheckNote(figures.recommendations[rec.id]);
      return note ? `${rec.action_text}. ${note}` : null;
    }),
  ].filter((line): line is string => line !== null);
  const statusLines = [
    ...excludedLines,
    ...figureLines,
    ...(unresolvedReferenceCount > 0
      ? [
          `${unresolvedReferenceCount} insight reference${unresolvedReferenceCount === 1 ? "" : "s"} in this narrative ${unresolvedReferenceCount === 1 ? "is" : "are"} no longer accepted or no longer exist${unresolvedReferenceCount === 1 ? "s" : ""}, and ${unresolvedReferenceCount === 1 ? "was" : "were"} left out.`,
        ]
      : []),
    ...Array.from(qualifiedLines).map(([summary, headlines]) =>
      headlines.length === 1 ? `${headlines[0]}. ${summary}` : `${headlines.length} items (${headlines.join("; ")}). ${summary}`,
    ),
  ];
  if (statusLines.length > 0) {
    const slide = pptx.addSlide();
    slide.background = { color: COLORS.ink };
    slide.addText("EVIDENCE STATUS: NEEDS REVIEW", {
      x: 0.6,
      y: 0.55,
      w: 8.6,
      h: 0.4,
      fontSize: 13,
      bold: true,
      fontFace: FONT.body,
      color: COLORS.accentOnDark,
      charSpacing: 2,
    });
    const fittedStatus = fitBulletList(statusLines, {
      fontSize: 13,
      widthIn: 8.4,
      heightIn: 3.6,
      minFontScale: 0.6,
    });
    slide.addText(
      fittedStatus.items.map((line) => ({
        text: line,
        options: { bullet: { code: "25AA" }, breakLine: true, color: "FFFFFF" },
      })),
      {
        x: 0.7,
        y: 1.15,
        w: 8.4,
        h: 3.6,
        fontSize: fittedStatus.fontSize,
        fontFace: FONT.body,
        valign: "top",
      },
    );
    addFooter(slide, deckTitle, "Evidence status");
  }

  // The evidence trail of each recommendation in the deck, as the Word report's appendix has it. Read one
  // recommendation at a time after the deck's own reads, so one unreadable trail is stated on its slide
  // rather than failing the deck or silently leaving that trail out. Recommendations left out above
  // (support no longer valid) have no trail here either.
  const evidenceTrails: EvidenceTrail[] = [];
  // One context for every trail, read on its own connections (B39-F01); a failed read is stated on each.
  // EC10K-P01: the served decisions and brief passages of every trail are read once, with the context.
  const trailContext = recommendations.length > 0 ? await loadTrailContext(TENANT_ID, runId, recommendations.map((r) => r.id)).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e)))) : null;
  for (const rec of recommendations) {
    try {
      if (trailContext instanceof Error) throw trailContext;
      evidenceTrails.push(await withTenantRead(TENANT_ID, (client) => loadEvidenceTrail(client, TENANT_ID, runId, rec.id, trailContext!)));
    } catch (e) {
      evidenceTrails.push(unreadableTrail(rec.action_text, e instanceof Error ? e.message : String(e)));
    }
  }
  addEvidenceTrailSlides(pptx, evidenceTrails, deckTitle);

  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const safeName = safeFileStem(
    run.project_name ?? run.decision_statement ?? "insights-report",
    "insights-report",
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${safeName}-insights-report-deck.pptx"`,
    },
  });
}
