import { NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";
import { withTenant } from "@/lib/db";
import {
  addTitleSlide,
  addFooter,
  addLabeledTextSlide,
  addBigStatementSlide,
  addSectionDivider,
  addEvidenceCard,
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
} from "@/lib/deckSlides";
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

type ExportRecommendation = {
  action_text: string;
  owner_role: string;
  timeline: string;
  metric: string;
  priority: "high" | "medium" | "low";
};

type ExportObjectiveValidation = {
  item_kind: "objective" | "decision";
  item_text: string;
  status: "resolved" | "partial" | "gap";
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
const OBJECTIVE_ROW = { H: 1.5, GAP: 0.22, GRID_X: 0.5, GRID_Y: 1.0, W: 9, PER_SLIDE: 2 } as const;

// PER_SLIDE is 2, not 3: at H=1.5 (the height a three-line evidence card
// actually needs to stay readable), three stacked cards plus their gaps
// run past the bottom of a 5.625in LAYOUT_16x9 slide and the third card
// gets clipped by the footer. Two per slide, with a little more breathing
// room between them, is what actually fits.
const INSIGHT_ROW = { H: 1.5, GAP: 0.22, GRID_X: 0.5, GRID_Y: 1.85, W: 9, PER_SLIDE: 2 } as const;

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
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;

  const result = await withTenant(TENANT_ID, async (client) => {
    const runResult = await client.query<{
      project_name: string | null;
      decision_statement: string | null;
      audience: string | null;
    }>("select project_name, decision_statement, audience from runs where id = $1", [runId]);

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
      [runId]
    );

    const narrative = narrativeResult.rows[0];
    const insightIds = narrative ? Array.from(new Set(narrative.pillars.flatMap((pillar) => pillar.insight_ids))) : [];

    const insightsResult =
      insightIds.length > 0
        ? await client.query<PillarInsight>(
            `select si.id, si.headline, si.observation, si.tension, si.implication, si.confidence_tier, si.quality_tier
             from synthesized_insights si
             where si.id = any($1::uuid[])`,
            [insightIds]
          )
        : null;

    const recommendationsResult = await client.query<ExportRecommendation>(
      `select r.action_text, r.owner_role, r.timeline, r.metric, r.priority
       from recommendations r
       join synthesized_insights si on si.id = r.synthesized_insight_id
       where r.run_id = $1 and r.status = 'accepted' and r.synthesized_insight_id is not null
       order by case r.priority when 'high' then 0 when 'medium' then 1 else 2 end, r.created_at`,
      [runId]
    );

    const objectiveValidationsResult = await client.query<ExportObjectiveValidation>(
      `select item_kind, item_text, status, conclusion, synthesized_insight_ids
       from objective_validations
       where run_id = $1
       order by item_kind, item_order`,
      [runId]
    );

    // An accepted synthesized insight that no objective/decision item's
    // array references at all -- evidence the project turned up that
    // nothing it originally asked about was pointing toward. Worth naming
    // on the deck rather than letting it disappear into a pillar as though
    // it always belonged there (see objectiveValidator.ts's doc comment).
    const unmappedInsightsResult = await client.query<{ headline: string }>(
      `select si.headline
       from synthesized_insights si
       where si.run_id = $1 and si.review_status = 'accepted'
         and not exists (
           select 1 from objective_validations ov
           where ov.run_id = $1 and si.id = any(ov.synthesized_insight_ids)
         )`,
      [runId]
    );

    return {
      run: runResult.rows[0],
      narrative,
      insightsById: new Map((insightsResult?.rows ?? []).map((row) => [row.id, row])),
      recommendations: recommendationsResult.rows,
      objectiveValidations: objectiveValidationsResult.rows,
      unmappedInsightHeadlines: unmappedInsightsResult.rows.map((row) => row.headline),
    };
  });

  const { run, narrative, insightsById, recommendations, objectiveValidations, unmappedInsightHeadlines } = result;

  if (!run) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!narrative) {
    return NextResponse.json(
      { error: "No Insights Report has been generated for this project yet. Generate it in the app first." },
      { status: 404 }
    );
  }

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  // project_name is often an internal slug a researcher typed while setting
  // the project up (e.g. "ValidateExisting"), never meant for a client to
  // see verbatim on the cover and every footer -- humanizeTitle only
  // touches unspaced slugs, so a real decision-statement-based title passes
  // through unchanged.
  const deckTitle = humanizeTitle(run.project_name ?? run.decision_statement ?? "Insights Elevator");

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
  const roadmapSlide = addDeckRoadmapSlide(pptx, { hasObjectives: objectiveValidations.length > 0 });
  addFooter(roadmapSlide, deckTitle, "Deck roadmap");

  // The "page one" a consulting deck leads with: a reader who only sees
  // this slide still walks away with the governing thought and the
  // headline action, before the SCQA build-up that follows justifies it.
  if (narrative.executive_summary) {
    const summarySlide = addLabeledTextSlide(pptx, {
      label: "Executive summary",
      body: narrative.executive_summary,
    });
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
  addFooter(scqaSlide, deckTitle, "SCQA");

  const situationSlide = addLabeledTextSlide(pptx, { label: "Situation", body: narrative.situation });
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

    const pageCount = Math.max(1, Math.ceil(objectiveValidations.length / OBJECTIVE_ROW.PER_SLIDE));
    for (let page = 0; page < pageCount; page++) {
      const slide = pptx.addSlide();
      slide.background = { color: COLORS.paper };
      const pageItems = objectiveValidations.slice(page * OBJECTIVE_ROW.PER_SLIDE, (page + 1) * OBJECTIVE_ROW.PER_SLIDE);

      slide.addText(
        pageCount > 1 ? `OBJECTIVES & DECISIONS · PAGE ${page + 1}/${pageCount}` : "OBJECTIVES & DECISIONS",
        { x: 0.5, y: 0.4, w: 9, h: 0.4, fontSize: 13, bold: true, fontFace: FONT.body, color: COLORS.accent, charSpacing: 2 }
      );

      pageItems.forEach((item, rowIndex) => {
        const y = OBJECTIVE_ROW.GRID_Y + rowIndex * (OBJECTIVE_ROW.H + OBJECTIVE_ROW.GAP);
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

      addFooter(slide, deckTitle, `Objectives & decisions · ${page + 1}/${pageCount}`);
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

  // The last thing the reader sees before the pillars themselves: a map of
  // how many there are and how each relates to the governing thought just
  // stated, so "PILLAR 1 OF N" isn't the first sign pillars exist at all.
  if (narrative.pillars.length > 0) {
    const mapSlide = addArgumentMapSlide(pptx, {
      governingThought: narrative.governing_thought,
      pillars: narrative.pillars.map((pillar) => ({ headline: pillar.headline })),
    });
    addFooter(mapSlide, deckTitle, "The shape of this argument");
  }

  narrative.pillars.forEach((pillar, pillarIndex) => {
    const insights = pillar.insight_ids
      .map((id) => insightsById.get(id))
      .filter((insight): insight is PillarInsight => Boolean(insight));
    const pageCount = Math.max(1, Math.ceil(insights.length / INSIGHT_ROW.PER_SLIDE));

    for (let page = 0; page < pageCount; page++) {
      const slide = pptx.addSlide();
      slide.background = { color: COLORS.paper };
      const pageInsights = insights.slice(page * INSIGHT_ROW.PER_SLIDE, (page + 1) * INSIGHT_ROW.PER_SLIDE);

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
        }
      );
      const fittedHeadline = fitParagraph(pillar.headline, { fontSize: 19, widthIn: 8.8, heightIn: 0.55, minFontScale: 0.65 });
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
        const fittedSoWhat = fitParagraph(pillar.so_what, { fontSize: 12, widthIn: 8.8, heightIn: 0.45, minFontScale: 0.7 });
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

      pageInsights.forEach((insight, rowIndex) => {
        const y = INSIGHT_ROW.GRID_Y + rowIndex * (INSIGHT_ROW.H + INSIGHT_ROW.GAP);
        const badge = confidenceBadgeFor(insight.confidence_tier);

        addEvidenceCard(slide, {
          x: INSIGHT_ROW.GRID_X,
          y,
          w: INSIGHT_ROW.W,
          h: INSIGHT_ROW.H,
          badge,
          lines: [
            { text: insight.headline, fontSize: 13, bold: true },
            { text: insight.observation, fontSize: 10, color: COLORS.body },
            { text: `“${insight.implication}”`, fontSize: 9.5, italic: true, color: COLORS.muted },
          ],
        });
      });

      addFooter(slide, deckTitle, `Pillar ${pillarIndex + 1} · ${page + 1}/${pageCount}`);
    }
  });

  addSectionDivider(pptx, {
    eyebrow: "From evidence to action",
    title: "What the data says to do about it.",
    subtitle: narrative.recommendations_intro || undefined,
  });

  const { CARDS_PER_ROW, CARD_W, CARD_H, CARD_GAP_X, CARD_GAP_Y, GRID_X, GRID_Y } = CARD_LAYOUT;
  const CARDS_PER_SLIDE = CARD_LAYOUT.CARDS_PER_ROW * CARD_LAYOUT.CARDS_PER_COL;
  const recPageCount = Math.max(1, Math.ceil(recommendations.length / CARDS_PER_SLIDE));

  for (let page = 0; page < recPageCount; page++) {
    const slide = pptx.addSlide();
    slide.background = { color: COLORS.paper };
    const pageRecs = recommendations.slice(page * CARDS_PER_SLIDE, (page + 1) * CARDS_PER_SLIDE);

    slide.addText(recPageCount > 1 ? `RECOMMENDED ACTIONS · ${page + 1}/${recPageCount}` : "RECOMMENDED ACTIONS", {
      x: 0.5,
      y: 0.4,
      w: 9,
      h: 0.4,
      fontSize: 13,
      bold: true,
      fontFace: FONT.body,
      color: COLORS.accent,
      charSpacing: 2,
    });

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
      const badge = PRIORITY_BADGES[rec.priority];

      addEvidenceCard(slide, {
        x,
        y,
        w: CARD_W,
        h: CARD_H,
        badge,
        lines: [
          { text: rec.action_text, fontSize: 11.5, bold: true },
          { text: `${rec.owner_role} · ${rec.timeline}`, fontSize: 9.5, italic: true, color: COLORS.muted },
        ],
      });
    });

    addFooter(slide, deckTitle, `Recommended actions · ${page + 1}/${recPageCount}`);
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
      { x: 0.7, y: 1.15, w: 8.4, h: 3.35, fontSize: fittedCaveats.fontSize, fontFace: FONT.body, valign: "top" }
    );
    const generatedLabel = new Date(narrative.generated_at).toLocaleDateString("en-ZA", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    slide.addShape("rect", { x: 0.7, y: 4.5, w: 8.4, h: 0.008, fill: { color: COLORS.ruleOnDark }, line: { type: "none" } });
    const footnoteText =
      `Based only on synthesized insights and recommendations explicitly accepted as of ${generatedLabel}. ` +
      "Confidence tier reflects how well-triangulated each insight's evidence is, not how important it is.";
    const fittedFootnote = fitParagraph(footnoteText, { fontSize: 10, widthIn: 8.4, heightIn: 0.6, minFontScale: 0.75 });
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

  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const safeName = safeFileStem(run.project_name ?? run.decision_statement ?? "insights-report", "insights-report");

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${safeName}-insights-report-deck.pptx"`,
    },
  });
}
