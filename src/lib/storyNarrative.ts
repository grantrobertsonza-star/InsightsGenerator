import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { capWords } from "./text";
import type { ConfidenceTier, QualityTier } from "./tiers";

type EvidenceInsight = {
  id: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  confidence_tier: ConfidenceTier;
  quality_tier: QualityTier;
  quality_score: number | null;
};

type EvidenceRecommendation = {
  action_text: string;
  owner_role: string;
  timeline: string;
  metric: string;
  priority: "high" | "medium" | "low";
  synthesized_insight_headline: string | null;
};

export type DeckPillar = {
  theme: string;
  headline: string;
  so_what: string;
  insight_ids: string[];
  // How many additional accepted insights the model judged as belonging to
  // this pillar beyond the MAX_INSIGHTS_PER_PILLAR shown on the deck. Lets
  // the deck say "+N more" instead of silently dropping evidence a
  // researcher might expect to see (same spirit as the recommendations cap
  // in the story export route): still reviewable in the Insights section,
  // just not dumped into the client-facing narrative.
  insight_overflow_count: number;
};

export type DeckNarrative = {
  // A short, standalone opening paragraph -- the "page one" a consulting
  // deck leads with so a reader who only sees one slide still gets the
  // answer and the headline action. Distinct from governing_thought, which
  // is the one-sentence apex claim the pillar slides go on to prove.
  executive_summary: string;
  situation: string;
  complication: string;
  question: string;
  governing_thought: string;
  pillars: DeckPillar[];
  recommendations_intro: string;
  caveats: string[];
  generated_at: string;
};

type RawPillar = {
  theme?: unknown;
  headline?: unknown;
  so_what?: unknown;
  insight_indices?: unknown;
};

// A client-ready story deck is a highlight reel, not an audit trail: every
// insight stays reviewable in the app's own Insights section regardless of
// whether it makes the deck. Capping here, in code, means the deck stays
// compact even if a future prompt change or a different model response
// stops respecting the "pick your strongest few" instruction below.
const MAX_INSIGHTS_PER_PILLAR = 3;
const confidenceRank: Record<string, number> = {
  strong: 0,
  moderate: 1,
  exploratory: 2,
};

/**
 * The narrative synthesis step behind the "Insights Report" deck: the one
 * place in this pipeline where a single Claude call is asked to read
 * everything the researcher has accepted and propose how it adds up to one
 * story, structured as a Pyramid Principle / SCQA argument (situation,
 * complication, question, a one-sentence governing thought as the answer,
 * then the pillars of evidence supporting it).
 *
 * Deliberately narrow about what the model is trusted to author. It writes
 * the narrative framing -- the executive summary, the
 * situation/complication/question/governing thought, and which pillar each
 * insight belongs under -- but it never restates insight text itself for
 * the deck to use verbatim: pillars carry insight_ids (resolved here from
 * indices into the exact list given, the same deterministic-matching
 * principle this pipeline applies anywhere a model's own id-tracking can't
 * be trusted (see extractFindings.ts's grounded_pattern_index resolution),
 * rather than trusting the model to copy a uuid correctly), and the deck
 * renderer pulls the actual headline,
 * observation, tension, and implication straight from the database by
 * those ids. That keeps the one genuinely model-authored part of the deck
 * (how the story is framed) separate from the part that must stay exactly
 * what a researcher already reviewed and accepted.
 *
 * Built on the synthesized-insight layer (the funnel's output), not the
 * raw per-finding insights: a run with 60 pre-insights behind 16
 * synthesized insights tells one client-ready story with 16 proof points,
 * not 60. Only draws on synthesized insights with review_status =
 * 'accepted' and recommendations anchored to one of them with status =
 * 'accepted': this document goes to a client, so it uses the conservative,
 * explicitly-reviewed bar, not "anything not yet rejected" the way some
 * internal exports do.
 */
export async function generateStoryNarrative(tenantId: string, runId: string): Promise<DeckNarrative> {
  const { run, insights, recommendations } = await withTenant(tenantId, async (client) => {
    const runResult = await client.query<{
      project_name: string | null;
      business_problem: string | null;
      research_objective: string | null;
      decision_statement: string | null;
      evidence_synthesis: string | null;
      audience: string | null;
    }>(
      `select project_name, business_problem, research_objective, decision_statement, evidence_synthesis, audience
       from runs where id = $1`,
      [runId]
    );

    const insightsResult = await client.query<EvidenceInsight>(
      `select si.id, si.headline, si.observation, si.tension, si.implication,
              si.confidence_tier, si.quality_tier, si.quality_score
       from synthesized_insights si
       where si.run_id = $1 and si.review_status = 'accepted'
       order by si.quality_score desc nulls last, si.created_at`,
      [runId]
    );

    const recommendationsResult = await client.query<EvidenceRecommendation>(
      `select r.action_text, r.owner_role, r.timeline, r.metric, r.priority, si.headline as synthesized_insight_headline
       from recommendations r
       join synthesized_insights si on si.id = r.synthesized_insight_id
       where r.run_id = $1 and r.status = 'accepted' and r.synthesized_insight_id is not null
       order by si.quality_score desc nulls last, r.created_at`,
      [runId]
    );

    return { run: runResult.rows[0], insights: insightsResult.rows, recommendations: recommendationsResult.rows };
  });

  if (!run) {
    throw new Error("Project not found");
  }
  if (insights.length === 0) {
    throw new Error(
      "No accepted synthesized insights yet. Run synthesis and accept at least one synthesized insight " +
        "before generating the Insights Report."
    );
  }

  const insightsBlock = insights
    .map(
      (insight, index) =>
        `${index}. (confidence: ${insight.confidence_tier ?? "not yet triangulated"}, quality: ${
          insight.quality_tier ?? "unscored"
        }) ` +
        `Headline: ${insight.headline}\n   Observation: ${insight.observation}\n   Tension: ${insight.tension}\n` +
        `   Implication: ${insight.implication}`
    )
    .join("\n");

  const recommendationsBlock =
    recommendations.length > 0
      ? recommendations
          .map(
            (rec) =>
              `- [${rec.priority.toUpperCase()}] ${rec.action_text} (${rec.owner_role}, ${rec.timeline})` +
              (rec.synthesized_insight_headline ? ` — from: ${rec.synthesized_insight_headline}` : "")
          )
          .join("\n")
      : "(No recommendations have been accepted yet.)";

  const strongCount = insights.filter((i) => i.confidence_tier === "strong").length;
  const moderateCount = insights.filter((i) => i.confidence_tier === "moderate").length;
  const exploratoryCount = insights.filter((i) => i.confidence_tier === "exploratory").length;
  const untieredCount = insights.filter((i) => !i.confidence_tier).length;

  const contextBlock = [
    run.business_problem ? `Business problem: ${run.business_problem}` : null,
    run.research_objective ? `Research objective: ${run.research_objective}` : null,
    run.decision_statement ? `Decision(s) this project exists to inform: ${run.decision_statement}` : null,
    run.evidence_synthesis ? `Evidence synthesis so far: ${run.evidence_synthesis}` : null,
    run.audience ? `Audience for this report: ${run.audience}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system:
      "You structure a market research project's accepted, already-synthesized insights into a single " +
      "client-ready narrative, using the Pyramid Principle / SCQA structure consulting reports use: an " +
      "executive summary a reader could stop after, Situation (the context), Complication (the tension or " +
      "problem that makes this matter now), Question (the decision this project exists to answer), and a " +
      "Governing Thought. This is a slide deck, not a report: the governing thought is ONE punchy sentence, " +
      "at most 30 words, stated as a clear assertion, not a paragraph stacking several claims with semicolons " +
      "or em dashes. If there's a second idea worth keeping, it belongs in a pillar's so_what or in a caveat, " +
      "not crammed into the governing thought.\n\n" +
      "Write for a time-pressed executive reading this on a slide, not a researcher reading a paper. Keep " +
      "executive_summary, situation, complication, governing_thought, every pillar headline, and every " +
      "so_what in plain business English: something you could say out loud to a CEO in one breath and have " +
      "them immediately understand. Keep raw statistical notation -- p-values, odds ratios, correlation " +
      "coefficients, standard deviations, percentage-of-variance figures, confidence intervals -- out of " +
      "these fields entirely; that detail belongs to the underlying evidence, not to the narrative framing " +
      "you're writing here. Avoid academic/technical jargon in these fields too (\"interaction effect\", " +
      "\"moderator\", \"latent construct\", \"quasi-separation\", \"collinear\", \"artifact of sparse cells\" " +
      "and similar) -- say what the finding means for the business instead of how it was measured. A single " +
      "plain, rounded figure (a percentage, a rand amount, a count) is fine when it sharpens a sentence; a " +
      "statistical test result is not.\n\n" +
      "Write executive_summary first, as 2 to 4 sentences a senior stakeholder could read alone on the opening " +
      "slide and walk away with the point: state the governing thought in plain terms and name the single " +
      "highest-priority action, without repeating the situation/complication build-up word for word.\n\n" +
      "Under the governing thought, group the accepted insights into 2 to 5 pillars: a pillar is a supporting " +
      "argument, not a theme label, so its headline must be a complete, assertive sentence (the 'so what'), " +
      "the way a McKinsey slide title states the finding rather than the topic, at most 18 words, one " +
      "sentence. so_what is a separate single sentence, at most 25 words, on why it matters to the decision.\n\n" +
      "Every insight below is numbered and already represents a cluster of corroborating evidence, not a " +
      "single raw observation. For each pillar, give the indices of the insights that belong to it (an " +
      "insight can support at most one pillar, pick its best fit), but this is a highlight reel: name only " +
      "the 2 to 4 strongest, most decision-relevant insights for that pillar, prioritizing ones with a " +
      "'strong' confidence tier and a higher quality score. Do not list every insight that could plausibly " +
      "fit; the rest stay reviewable elsewhere in the app, this deck is not the only place they're visible. " +
      "Use only the indices given; do not invent insights, numbers, or claims beyond what the list below " +
      "actually supports. The governing thought and every pillar headline must be a claim this evidence " +
      "actually backs, not an aspirational or generic restatement.\n\n" +
      `${contextBlock}\n\n` +
      "Accepted, synthesized insights (confidence tier reflects how well-triangulated the cluster behind it " +
      "is: \"strong\" means solid corroboration across sources, \"moderate\" some corroboration with gaps, " +
      "\"exploratory\" a single thread worth watching but not yet confirmed; quality tier is a separate check " +
      "on how well-formed and actionable the insight itself is):\n" +
      `${insightsBlock}\n\n` +
      `Accepted recommendations:\n${recommendationsBlock}\n\n` +
      `Of the ${insights.length} accepted synthesized insights, ${strongCount} carry a "strong" confidence ` +
      `tier, ${moderateCount} "moderate", ${exploratoryCount} "exploratory", and ${untieredCount} have not ` +
      "yet been tiered. Write 2 to 4 caveats grounded in specifics like this (which confidence tier is " +
      "thinnest, what the evidence doesn't yet cover, where a pillar rests on exploratory rather than strong " +
      "evidence), not generic disclaimers. Also write recommendations_intro: one sentence transitioning from " +
      "the evidence into the recommended actions.",
    tool_choice: { type: "tool", name: "record_narrative" },
    tools: [
      {
        name: "record_narrative",
        description: "Records the structured SCQA/Pyramid Principle narrative for this project's insights report.",
        input_schema: {
          type: "object",
          properties: {
            executive_summary: { type: "string" },
            situation: { type: "string" },
            complication: { type: "string" },
            question: { type: "string" },
            governing_thought: { type: "string" },
            pillars: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  theme: { type: "string" },
                  headline: { type: "string", description: "A complete, assertive sentence, not a topic label." },
                  so_what: { type: "string", description: "One sentence on why this matters to the decision." },
                  insight_indices: { type: "array", items: { type: "integer" } },
                },
                required: ["theme", "headline", "so_what", "insight_indices"],
              },
            },
            recommendations_intro: { type: "string" },
            caveats: { type: "array", items: { type: "string" } },
          },
          required: [
            "executive_summary",
            "situation",
            "complication",
            "question",
            "governing_thought",
            "pillars",
            "recommendations_intro",
            "caveats",
          ],
        },
      },
    ],
    messages: [{ role: "user", content: "Build the narrative structure now." }],
  });

  await logApiUsage(tenantId, runId, "story_narrative", response.usage);

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a structured narrative");
  }

  const raw = toolUse.input as {
    executive_summary?: unknown;
    situation?: unknown;
    complication?: unknown;
    question?: unknown;
    governing_thought?: unknown;
    pillars?: unknown;
    recommendations_intro?: unknown;
    caveats?: unknown;
  };

  const asText = (value: unknown, fallback: string) => (typeof value === "string" && value.trim() ? value.trim() : fallback);

  const rawPillars = Array.isArray(raw.pillars) ? (raw.pillars as RawPillar[]) : [];
  const pillars: DeckPillar[] = [];
  for (const rawPillar of rawPillars) {
    const theme = asText(rawPillar.theme, "");
    const headline = capWords(asText(rawPillar.headline, ""), 22);
    const soWhat = capWords(asText(rawPillar.so_what, ""), 30);
    const indices = Array.isArray(rawPillar.insight_indices)
      ? rawPillar.insight_indices.filter(
          (value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value < insights.length
        )
      : [];
    if (!headline || indices.length === 0) continue;
    const uniqueIndices = [...new Set(indices)];
    // Defensive cap: even if the model names more than MAX_INSIGHTS_PER_PILLAR,
    // keep only the strongest few here so a prompt regression can't bring
    // back the "every insight gets a slide" data dump. Ranked by confidence
    // tier (strong first), then by quality score, rather than the order the
    // model listed them in, since that's what "strongest proof point"
    // actually means.
    const ranked = [...uniqueIndices].sort((a, b) => {
      const tierA = confidenceRank[insights[a].confidence_tier ?? ""] ?? 3;
      const tierB = confidenceRank[insights[b].confidence_tier ?? ""] ?? 3;
      if (tierA !== tierB) return tierA - tierB;
      return (insights[b].quality_score ?? 0) - (insights[a].quality_score ?? 0);
    });
    const kept = ranked.slice(0, MAX_INSIGHTS_PER_PILLAR);
    const insightIds = kept.map((index) => insights[index].id);
    pillars.push({
      theme: theme || "Key finding",
      headline,
      so_what: soWhat,
      insight_ids: insightIds,
      insight_overflow_count: Math.max(0, uniqueIndices.length - kept.length),
    });
  }

  if (pillars.length === 0) {
    throw new Error("Claude did not group any accepted insights into pillars; try again or review the insights first.");
  }

  const rawCaveats = Array.isArray(raw.caveats)
    ? raw.caveats.filter((value): value is string => typeof value === "string" && value.trim() !== "")
    : [];

  const narrative: DeckNarrative = {
    executive_summary: capWords(asText(raw.executive_summary, ""), 115),
    situation: capWords(asText(raw.situation, ""), 75),
    complication: capWords(asText(raw.complication, ""), 75),
    question: asText(raw.question, run.decision_statement ?? ""),
    governing_thought: capWords(asText(raw.governing_thought, ""), 34),
    pillars,
    recommendations_intro: capWords(asText(raw.recommendations_intro, ""), 32),
    caveats: rawCaveats.map((caveat) => capWords(caveat, 38)),
    generated_at: new Date().toISOString(),
  };

  await withTenant(tenantId, async (client) => {
    await client.query(
      `insert into deck_narratives
         (tenant_id, run_id, executive_summary, situation, complication, question, governing_thought, pillars,
          recommendations_intro, caveats, generated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       on conflict (run_id) do update set
         executive_summary = excluded.executive_summary,
         situation = excluded.situation,
         complication = excluded.complication,
         question = excluded.question,
         governing_thought = excluded.governing_thought,
         pillars = excluded.pillars,
         recommendations_intro = excluded.recommendations_intro,
         caveats = excluded.caveats,
         generated_at = excluded.generated_at`,
      [
        tenantId,
        runId,
        narrative.executive_summary,
        narrative.situation,
        narrative.complication,
        narrative.question,
        narrative.governing_thought,
        JSON.stringify(narrative.pillars),
        narrative.recommendations_intro,
        JSON.stringify(narrative.caveats),
      ]
    );
  });

  return narrative;
}
