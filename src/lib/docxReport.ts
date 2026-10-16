import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  BorderStyle,
  ImageRun,
} from "docx";
import type { DiscoveryReportData } from "./discoveryReport";

// Shared with the deck's own humanizeTitle/safeFileStem helpers in
// deckSlides.ts, kept as a plain local copy rather than an import so this
// report's text formatting never silently drifts if the slide deck's own
// helpers change shape for a slide-specific reason.
export function humanizeTitle(raw: string): string {
  const looksLikeSlug =
    /^[a-z0-9]+([A-Z][a-z0-9]*)*$/.test(raw) &&
    /[A-Z]/.test(raw) &&
    !raw.includes(" ");
  if (!looksLikeSlug) return raw;
  return raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

export function safeFileStem(
  raw: string | null | undefined,
  fallback: string,
): string {
  const base = (raw ?? "").trim() || fallback;
  return (
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || fallback
  );
}

const INK = "1A1A1A";
const MUTED = "595959";
const RULE = "D9D9D9";
const ACCENT = "1E2761";
// A qualification that must not read as ordinary body text (FND-001 framing notes).
const QUALIFY = "A1261B";

const BODY_FONT = "Calibri";
const DISPLAY_FONT = "Cambria";

function heading(
  text: string,
  level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1,
) {
  return new Paragraph({
    text,
    heading: level,
    spacing: { before: 360, after: 160 },
  });
}

function body(text: string, opts: { italic?: boolean; color?: string } = {}) {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: BODY_FONT,
        size: 22,
        italics: opts.italic,
        color: opts.color ?? INK,
      }),
    ],
    spacing: { after: 200 },
  });
}

function label(text: string, color: string = ACCENT) {
  return new Paragraph({
    children: [
      new TextRun({
        text: text.toUpperCase(),
        font: BODY_FONT,
        size: 18,
        bold: true,
        color,
        characterSpacing: 20,
      }),
    ],
    spacing: { before: 280, after: 80 },
  });
}

function bullet(text: string, color: string = INK) {
  return new Paragraph({
    children: [new TextRun({ text, font: BODY_FONT, size: 21, color })],
    bullet: { level: 0 },
    spacing: { after: 90 },
  });
}

function rule() {
  return new Paragraph({
    text: "",
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 1 },
    },
    spacing: { after: 240 },
  });
}

// Page content inside default margins is roughly 624px wide at 96dpi (6.5in);
// 600 leaves a little breathing room on each side. renderChartImage.ts
// renders well past this (it upscales for crispness -- see its own
// RENDER_DENSITY comment), so displaying at this width, not the image's
// full pixel size, is what actually makes the extra resolution pay off as
// sharpness rather than an oversized picture.
const CHART_IMAGE_DISPLAY_WIDTH = 600;

function chartImageParagraph(image: {
  png: Buffer;
  width: number;
  height: number;
}) {
  const displayWidth = Math.min(CHART_IMAGE_DISPLAY_WIDTH, image.width);
  const displayHeight = Math.round(image.height * (displayWidth / image.width));
  return new Paragraph({
    children: [
      new ImageRun({
        data: image.png,
        transformation: { width: displayWidth, height: displayHeight },
        type: "png",
      }),
    ],
    spacing: { after: 80 },
  });
}

export type NarrativeReportPillar = {
  headline: string;
  so_what: string;
  insights: {
    headline: string;
    observation: string;
    implication: string;
    /** FND-001/REP-OUT-001 (second counter-review): export-worthy caveat labels aggregated
     * live, at export time, from every still-eligible (non-rejected) finding this insight was
     * built from - never from deck_narratives.caveats, which is model-authored free text and
     * does not qualify specific evidence numbers (see that table's own migration comment).
     * Omitted or [] when this insight carries no export-worthy caveat, so it renders with no
     * extra line - this must stay invisible when there is nothing to say. Distinct from
     * omittedInsightCount below: that says an insight is no longer current; this says a still-
     * current insight carries residual uncertainty. The two never merge into one sentence. */
    caveats?: string[];
    /** FND-001: set when this insight's support changed since it was drafted, or cannot be
     * checked (supportStatus.ts summariseSupport) - e.g. "Support changed since drafted: the
     * figures in "..." changed." Rendered as its own line, separate from caveats: a caveat
     * qualifies current evidence; this says the evidence itself moved. Omitted when the support
     * is current, so a current insight renders exactly as before. */
    supportNote?: string;
  }[];
  /** REP-OUT-001: how many of this pillar's ORIGINAL referenced insights were left out of
   * `insights` above because they (or a finding one of their pre-insights depends on) are no
   * longer accepted - see the export routes' own comment on the `insightsResult` query. Omitted
   * or 0 when nothing was left out, so a caller only needs to check this before rendering a
   * pillar, never diff insight_ids itself. This replaces a silent `.filter(Boolean)` drop: the
   * reader of this report is told a pillar thinned out, rather than seeing a shorter pillar with
   * no explanation that anything changed since it was written. */
  omittedInsightCount?: number;
  /** FND-001 / REP-OUT-001: what was left out of this pillar and why (headline plus reason), so
   * the reader sees which conclusions were withdrawn, not only how many. omittedInsightCount
   * stays equal to its length. */
  excluded?: { headline: string; reason: string }[];
};

export type NarrativeReportObjectiveItem = {
  item_kind: "objective" | "decision";
  item_text: string;
  status: "resolved" | "partial" | "gap" | "inferred";
  conclusion: string;
};

export type NarrativeReportRecommendation = {
  action_text: string;
  owner_role: string;
  timeline: string;
  metric: string;
  priority: "high" | "medium" | "low";
  /** FND-001/REP-OUT-001 (second counter-review): same meaning and same aggregation rule as
   * NarrativeReportPillar['insights'][number]['caveats'] - a recommendation is itself a claim
   * anchored to a synthesized insight, so it is qualified the same way, via the insight it is
   * anchored to (recommendations.synthesized_insight_id). */
  caveats?: string[];
  /** FND-001: inherited from the anchor insight's support status; same meaning as
   * NarrativeReportPillar['insights'][number]['supportNote']. */
  supportNote?: string;
};

export type NarrativeReportDocument = {
  kind: "report" | "table" | "transcript" | "evidence";
  source_filename: string;
};

export type NarrativeReportFinding = {
  finding_text: string;
  theme: string | null;
  verdict_tier: "robust" | "use_with_caution" | null;
};

// A chart rendered server-side (renderChartImage.ts) for one theme's worth
// of chart-eligible findings -- structurally the same shape
// buildChartImagesByTheme (exportChartImages.ts) already returns, so a
// caller can pass that result straight through without remapping it.
export type NarrativeReportChartImage = {
  theme: string;
  caption: string;
  image: { png: Buffer; width: number; height: number };
};

export type NarrativeReportInput = {
  title: string;
  /** REP-OUT-001 / FND-001: true when at least one pillar had an insight omitted for the reason
   * NarrativeReportPillar['omittedInsightCount'] documents - surfaced once, at the top of the
   * Insights section, as a single run-level note rather than only the per-pillar counts, so a
   * reader who skims past one pillar's note still sees that this narrative's framing may be out
   * of date overall. This does not rewrite governingThought/executiveSummary - closing that
   * fully is a narrative-GENERATION concern (regenerating the narrative text itself), out of
   * scope for an export-time fix; this only flags that the framing may no longer match the
   * evidence it was written from. */
  narrativeMayBeStale?: boolean;
  /** FND-001: the qualification for the narrative's saved framing (narrativeFramingQualification),
   * printed directly after the executive summary and after the governing thought - beside the
   * passages it qualifies, not only as a distant note. The framing text itself is printed as
   * saved. Omitted when every insight the narrative cites has current support. */
  framingNote?: string;
  /** Numerical traceability (numberTrace.ts): the narrative's own figure-check note (figures that
   * need review or are unsupported), or that the checks could not be read. Rendered once at the
   * top of the Insights section. Omitted when every figure traced or nothing was checked. */
  figureNote?: string;
  /** FND-001 / REP-OUT-001: every insight and recommendation the generated narrative referenced
   * that this export left out because its support is no longer valid or it is no longer
   * accepted, with the reason. Rendered as its own "Excluded from this report" section so a
   * withdrawn conclusion is visible rather than silently missing. Omitted or [] when nothing was
   * excluded. */
  excludedFromReport?: { kind: "insight" | "recommendation" | "contradiction"; headline: string; reason: string }[];
  decisionStatement: string | null;
  audience: string | null;
  businessProblem: string | null;
  researchObjective: string | null;
  entryPoint: "generate" | "validate" | null;
  methodology: string | null;
  executiveSummary: string;
  situation: string;
  complication: string;
  question: string;
  governingThought: string;
  documents: NarrativeReportDocument[];
  findings: NarrativeReportFinding[];
  // Keyed implicitly by theme (see NarrativeReportChartImage.theme) rather
  // than pre-grouped, since the Findings section below groups `findings`
  // by theme itself and just looks each one up as it goes.
  chartImagesByTheme: NarrativeReportChartImage[];
  objectiveItems: NarrativeReportObjectiveItem[];
  unmappedInsightHeadlines: string[];
  pillars: NarrativeReportPillar[];
  recommendationsIntro: string;
  recommendations: NarrativeReportRecommendation[];
  caveats: string[];
  generatedAt: string;
  // The validated / net-new split (see discoveryClassification.ts). Optional
  // so a caller that has not loaded it still produces the same report as
  // before; the section below simply does not appear.
  discovery?: DiscoveryReportData;
};

const statusLabel: Record<NarrativeReportObjectiveItem["status"], string> = {
  resolved: "Resolved",
  partial: "Partially answered",
  gap: "Gap",
  inferred: "Inferred, not independently tested",
};

const priorityLabel: Record<NarrativeReportRecommendation["priority"], string> =
  {
    high: "High priority",
    medium: "Medium priority",
    low: "Lower priority",
  };

const documentKindLabel: Record<NarrativeReportDocument["kind"], string> = {
  report: "report or document",
  table: "data table",
  transcript: "interview or focus-group transcript",
  evidence: "brief or proposal document",
};

const verdictTierLabel: Record<string, string> = {
  robust: "robust",
  use_with_caution: "usable with caution",
};

const qualityTierLabel: Record<string, string> = {
  qualified: "Qualified insight",
  partial: "Partial insight",
  finding: "Finding level",
};

/**
 * The section that lists, separately, what this analysis added beyond what
 * the original report said: new insights, new findings mined from the data,
 * and any place the evidence contradicts a claim the report made. Empty
 * (returns no paragraphs) when there is nothing to say and nothing the
 * reader needs to be warned about, so a run with no net-new content does not
 * grow a hollow heading.
 */
function buildDiscoverySection(d: DiscoveryReportData): Paragraph[] {
  const hasContent =
    d.netNewInsights.length > 0 ||
    d.netNewFindings.length > 0 ||
    d.contradictions.length > 0;
  if (!hasContent && !d.verificationNote) return [];

  const out: Paragraph[] = [];
  out.push(rule());
  out.push(heading("New insights beyond the report", HeadingLevel.HEADING_1));
  out.push(
    body(
      "Everything in the sections above that traces back to a claim the original material made is validated: " +
        "it was checked, not originated, here. What follows is different. It only exists because this analysis " +
        "surfaced it, so it is listed on its own.",
      { italic: true, color: MUTED },
    ),
  );
  if (d.verificationNote) {
    out.push(label("How far this could be checked", "B45309"));
    out.push(
      body(
        `${d.verificationNote} Insight quality was still assessed, because that is a read of each claim's own ` +
          "reasoning and needs no underlying data. Treat every verdict in this report accordingly.",
      ),
    );
  }

  if (d.netNewInsights.length > 0) {
    out.push(heading("New insights", HeadingLevel.HEADING_2));
    for (const insight of d.netNewInsights) {
      out.push(
        new Paragraph({
          children: [
            new TextRun({
              text: insight.headline,
              bold: true,
              font: BODY_FONT,
              size: 21,
            }),
            ...(insight.qualityTier
              ? [
                  new TextRun({
                    text: `  [${qualityTierLabel[insight.qualityTier] ?? insight.qualityTier}]`,
                    font: BODY_FONT,
                    size: 18,
                    color: ACCENT,
                  }),
                ]
              : []),
          ],
          spacing: { before: 140, after: 40 },
        }),
      );
      out.push(
        body(`“${insight.implication}”`, { italic: true, color: MUTED }),
      );
      out.push(body(insight.provenanceCaption, { color: MUTED }));
      // FND-001: changed or uncheckable support, said beside the insight it qualifies.
      if (insight.supportNote) out.push(body(insight.supportNote, { italic: true, color: MUTED }));
    }
  }

  if (d.netNewFindings.length > 0) {
    out.push(heading("New findings from the data", HeadingLevel.HEADING_2));
    out.push(
      body(
        "Patterns computed directly from the supplied tables that no claim in the original report points at.",
        { color: MUTED },
      ),
    );
    for (const finding of d.netNewFindings) {
      out.push(
        bullet(
          `${finding.theme ? `${finding.theme}: ` : ""}${finding.text} (${verdictTierLabel[finding.verdictTier] ?? finding.verdictTier}${finding.source ? `; source: ${finding.source}` : ""})`,
        ),
      );
    }
    if (d.netNewFindingsOmitted > 0) {
      out.push(
        body(
          `${pluralize(d.netNewFindingsOmitted, "further net-new finding")} passed verification and appear in the ` +
            "Findings section above.",
          { color: MUTED },
        ),
      );
    }
  }

  if (d.contradictions.length > 0) {
    out.push(
      heading(
        "Where the evidence contradicts the report",
        HeadingLevel.HEADING_2,
      ),
    );
    out.push(
      body(
        "These are corrections, not additions. Each claim below was rated as not supported because of what is " +
          "set against it, whatever else it had going for it.",
        { color: MUTED },
      ),
    );
    for (const c of d.contradictions) {
      const by =
        c.contradictedBy === "net_new_finding"
          ? "a new finding from the data"
          : c.contradictedBy === "net_new_insight"
            ? "a new insight"
            : "another claim in the same report";
      out.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "The report said: ",
              bold: true,
              font: BODY_FONT,
              size: 21,
            }),
            new TextRun({
              text: `“${c.originalText}”`,
              font: BODY_FONT,
              size: 21,
            }),
          ],
          spacing: { before: 160, after: 40 },
        }),
      );
      out.push(
        body(
          `Contradicted by ${by}: “${c.contradictingText}”. ${c.rationale}${c.supportNote ? ` ${c.supportNote}` : ""}`,
          { color: MUTED },
        ),
      );
    }
  }

  return out;
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Groups a flat list by a key, preserving first-seen key order -- used to
 * group findings by theme and documents by kind without pulling in a
 * dependency for something this small.
 */
function groupBy<T, K extends string>(
  items: T[],
  keyOf: (item: T) => K,
): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const existing = map.get(key);
    if (existing) {
      existing.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}

/**
 * Builds the narrative-report counterpart to the Insights Report deck, laid
 * out as a traditional research report rather than the deck's SCQA /
 * Pyramid Principle persuasive structure: executive summary, introduction
 * (business problem, objectives, background), methodology, findings,
 * insights, recommendations, next steps. The deck leads with the answer and
 * builds the case backward, because that's how a consulting presentation is
 * meant to persuade a room; a written report a reader works through at their
 * own pace is better served by the conventional order a research report
 * already trains readers to expect. Same accepted-evidence boundary as the
 * deck throughout (see story/export/route.ts's doc comment) -- only
 * reviewed, accepted material appears, nothing here is restated or invented
 * by the model.
 */
export async function buildNarrativeReportDocx(
  input: NarrativeReportInput,
): Promise<Buffer> {
  const children: Paragraph[] = [];

  const generatedLabel = new Date(input.generatedAt).toLocaleDateString(
    "en-ZA",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    },
  );

  // --- Title block ---------------------------------------------------
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: input.title,
          font: DISPLAY_FONT,
          size: 40,
          bold: true,
          color: INK,
        }),
      ],
      spacing: { after: 120 },
    }),
  );
  if (input.decisionStatement) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: input.decisionStatement,
            font: BODY_FONT,
            size: 22,
            italics: true,
            color: MUTED,
          }),
        ],
        spacing: { after: 80 },
      }),
    );
  }
  if (input.audience) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Prepared for: ${input.audience}`,
            font: BODY_FONT,
            size: 20,
            color: MUTED,
          }),
        ],
        spacing: { after: 80 },
      }),
    );
  }
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Generated ${generatedLabel}`,
          font: BODY_FONT,
          size: 18,
          color: MUTED,
        }),
      ],
      spacing: { after: 320 },
    }),
  );
  children.push(rule());

  // --- Executive summary ----------------------------------------------
  if (input.executiveSummary) {
    children.push(heading("Executive summary", HeadingLevel.HEADING_1));
    children.push(body(input.executiveSummary));
    if (input.framingNote) children.push(body(input.framingNote, { italic: true, color: QUALIFY }));
  }

  // --- Introduction: business problem, objectives, background --------
  children.push(heading("Introduction", HeadingLevel.HEADING_1));
  if (input.businessProblem) {
    children.push(label("Business problem"));
    children.push(body(input.businessProblem));
  }
  if (input.researchObjective) {
    children.push(label("Research objective"));
    children.push(body(input.researchObjective));
  }
  if (input.situation || input.complication) {
    children.push(label("Background"));
    if (input.situation) children.push(body(input.situation));
    if (input.complication)
      children.push(body(input.complication, { color: MUTED }));
  }
  if (input.question) {
    children.push(label("Key question"));
    children.push(body(input.question, { italic: true }));
  }

  // --- Methodology -------------------------------------------------------
  // The ORIGINAL research methodology behind the underlying study --
  // sampling, data collection, instruments, participants, timeframe -- as
  // stated in the uploaded brief, proposal, or full report, never invented
  // or inferred (see src/lib/methodologyExtractor.ts). Deliberately not the
  // place this tool's own processing is described; that note lives under
  // Scope & limitations further down, kept separate so a reader never
  // mistakes how this analysis was run for how the original research was
  // designed.
  children.push(rule());
  children.push(heading("Methodology", HeadingLevel.HEADING_1));
  if (input.methodology) {
    children.push(body(input.methodology));
  } else {
    children.push(
      body(
        "No research methodology was stated in the uploaded brief, proposal, or report. How the underlying " +
          "evidence was gathered -- sampling, data collection, instruments, participants, timeframe -- is not " +
          "documented in the source material supplied for this project.",
      ),
    );
  }
  if (input.documents.length > 0) {
    const documentsByKind = groupBy(input.documents, (doc) => doc.kind);
    const inventoryLine = Array.from(documentsByKind.entries())
      .map(([kind, docs]) => pluralize(docs.length, documentKindLabel[kind]))
      .join(", ");
    children.push(label("Source documents", MUTED));
    children.push(
      body(`This analysis draws on ${inventoryLine}:`, { color: MUTED }),
    );
    for (const [, docs] of documentsByKind) {
      for (const doc of docs) {
        children.push(bullet(doc.source_filename, MUTED));
      }
    }
  }

  // --- Findings ----------------------------------------------------------
  children.push(rule());
  children.push(heading("Findings", HeadingLevel.HEADING_1));
  if (input.findings.length === 0) {
    children.push(
      body("No verified findings are recorded against this project yet."),
    );
  } else {
    const chartImageByTheme = new Map(
      input.chartImagesByTheme.map((c) => [c.theme, c]),
    );
    const findingsByTheme = groupBy(
      input.findings,
      (f) => f.theme ?? "Uncategorized",
    );
    for (const [theme, items] of findingsByTheme) {
      children.push(label(theme, MUTED));
      const chartImage = chartImageByTheme.get(theme);
      if (chartImage) {
        children.push(chartImageParagraph(chartImage.image));
        children.push(body(chartImage.caption, { italic: true, color: MUTED }));
        children.push(
          body("Individual comparisons behind this chart:", { color: MUTED }),
        );
      }
      for (const finding of items) {
        const tierSuffix = finding.verdict_tier
          ? ` (${verdictTierLabel[finding.verdict_tier]})`
          : "";
        children.push(bullet(`${finding.finding_text}${tierSuffix}`));
      }
    }
  }

  // --- Insights (the synthesized, cross-source argument) ------------------
  children.push(rule());
  children.push(heading("Insights", HeadingLevel.HEADING_1));
  if (input.governingThought) {
    children.push(
      body(input.governingThought, { italic: true, color: ACCENT }),
    );
  }
  if (input.governingThought && input.framingNote) {
    children.push(body(input.framingNote, { italic: true, color: QUALIFY }));
  } else if (input.narrativeMayBeStale) {
    children.push(
      body(
        "This narrative's framing may be out of date: one or more insights it referenced when generated are no longer current. Regenerate it to incorporate the change.",
        { italic: true, color: MUTED },
      ),
    );
  }
  if (input.figureNote) {
    children.push(body(input.figureNote, { italic: true, color: MUTED }));
  }

  input.pillars.forEach((pillar, index) => {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Theme ${index + 1} of ${input.pillars.length} — `,
            font: BODY_FONT,
            size: 21,
            color: ACCENT,
          }),
          new TextRun({
            text: pillar.headline,
            font: DISPLAY_FONT,
            size: 26,
            bold: true,
            color: INK,
          }),
        ],
        spacing: { before: 320, after: 80 },
      }),
    );
    if (pillar.so_what) {
      children.push(body(pillar.so_what, { italic: true, color: MUTED }));
    }
    if (pillar.omittedInsightCount) {
      children.push(
        body(
          `${pillar.omittedInsightCount} insight${pillar.omittedInsightCount === 1 ? "" : "s"} referenced here ${pillar.omittedInsightCount === 1 ? "is" : "are"} no longer current and ${pillar.omittedInsightCount === 1 ? "has" : "have"} been left out.`,
          { italic: true, color: MUTED },
        ),
      );
      for (const item of pillar.excluded ?? []) {
        children.push(body(`Left out: ${item.headline} (${item.reason})`, { italic: true, color: MUTED }));
      }
    }
    for (const insight of pillar.insights) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: insight.headline,
              bold: true,
              font: BODY_FONT,
              size: 21,
            }),
          ],
          spacing: { before: 140, after: 40 },
        }),
      );
      children.push(body(insight.observation));
      children.push(
        body(`“${insight.implication}”`, { italic: true, color: MUTED }),
      );
      if (insight.supportNote) {
        children.push(body(insight.supportNote, { italic: true, color: MUTED }));
      }
      if (insight.caveats && insight.caveats.length > 0) {
        children.push(
          body(`Caveats: ${insight.caveats.join("; ")}.`, {
            italic: true,
            color: MUTED,
          }),
        );
      }
    }
  });

  if (input.objectiveItems.length > 0) {
    children.push(
      heading("What this means for what you asked", HeadingLevel.HEADING_2),
    );
    for (const item of input.objectiveItems) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `[${statusLabel[item.status]}] `,
              bold: true,
              font: BODY_FONT,
              size: 21,
              color:
                item.status === "resolved"
                  ? "15803D"
                  : item.status === "partial"
                    ? "B45309"
                    : MUTED,
            }),
            new TextRun({
              text: `${item.item_kind === "objective" ? "Objective" : "Decision"}: ${item.item_text}`,
              bold: true,
              font: BODY_FONT,
              size: 21,
            }),
          ],
          spacing: { before: 160, after: 40 },
        }),
      );
      children.push(body(item.conclusion, { color: MUTED }));
    }
    if (input.objectiveItems.some((i) => i.status === "inferred")) {
      children.push(
        body(
          "Note on inferred objectives: where no objective was stated, objectives were generated from this " +
            "project's own evidence. Because the same evidence was then used to check them, they cannot " +
            "show that the research answered what was asked, so no verdict is given. Treat them as themes " +
            "the evidence points to, and set a stated objective if a real test is needed.",
          { italic: true, color: MUTED },
        ),
      );
    }

    if (input.unmappedInsightHeadlines.length > 0) {
      children.push(label("Beyond the original brief", "0F766E"));
      children.push(
        body(
          `The evidence also surfaced ${input.unmappedInsightHeadlines.length} accepted insight` +
            `${input.unmappedInsightHeadlines.length === 1 ? "" : "s"} that none of the objectives or decisions ` +
            `above asked about: ${input.unmappedInsightHeadlines.join("; ")}.`,
        ),
      );
    }
  }

  // --- New beyond the report: the net-new half of the validated/net-new split
  if (input.discovery) {
    children.push(...buildDiscoverySection(input.discovery));
  }

  // --- Recommendations -----------------------------------------------
  children.push(rule());
  children.push(heading("Recommendations", HeadingLevel.HEADING_1));
  if (input.recommendationsIntro) {
    children.push(
      body(input.recommendationsIntro, { italic: true, color: MUTED }),
    );
  }
  if (input.recommendations.length === 0) {
    children.push(body("No recommendations have been accepted yet."));
  }
  for (const rec of input.recommendations) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `[${priorityLabel[rec.priority]}] `,
            bold: true,
            font: BODY_FONT,
            size: 21,
            color: ACCENT,
          }),
          new TextRun({
            text: rec.action_text,
            bold: true,
            font: BODY_FONT,
            size: 21,
          }),
        ],
        spacing: { before: 160, after: 40 },
      }),
    );
    children.push(
      body(
        `${rec.owner_role} · ${rec.timeline} · Success metric: ${rec.metric}`,
        { color: MUTED },
      ),
    );
    if (rec.supportNote) {
      children.push(body(rec.supportNote, { italic: true, color: MUTED }));
    }
    if (rec.caveats && rec.caveats.length > 0) {
      children.push(
        body(`Caveats: ${rec.caveats.join("; ")}.`, {
          italic: true,
          color: MUTED,
        }),
      );
    }
  }

  // FND-001 / REP-OUT-001: withdrawn conclusions, listed rather than silently dropped.
  const excludedFromReport = input.excludedFromReport ?? [];
  if (excludedFromReport.length > 0) {
    children.push(rule());
    children.push(heading("Excluded from this report: needs review", HeadingLevel.HEADING_1));
    children.push(
      body(
        "These conclusions and contradictions were part of this report's generated content but are not reported above, because the evidence " +
          "they rested on was rejected or removed, or they are no longer accepted. Review them in the app before " +
          "relying on this report.",
        { color: MUTED },
      ),
    );
    for (const item of excludedFromReport) {
      children.push(
        body(`${item.kind === "insight" ? "Insight" : item.kind === "contradiction" ? "Contradiction" : "Recommendation"}: ${item.headline} (${item.reason})`),
      );
    }
  }

  // --- Next steps: gaps worth following up, plus scope & limitations -----
  children.push(rule());
  children.push(heading("Next steps", HeadingLevel.HEADING_1));
  const gapItems = input.objectiveItems.filter((item) => item.status === "gap");
  if (gapItems.length > 0 || input.recommendations.length > 0) {
    children.push(
      body(
        "Beyond acting on the recommendations above, this project points to a few specific places to follow up:",
      ),
    );
    for (const item of gapItems) {
      children.push(
        bullet(
          `Further work is needed on the ${item.item_kind === "objective" ? "objective" : "decision"}: "${item.item_text}" ` +
            `-- the accepted evidence did not resolve it.`,
        ),
      );
    }
    if (input.recommendations.some((r) => r.priority === "high")) {
      children.push(
        bullet(
          "Prioritise the high-priority recommendations above before the medium- and lower-priority ones.",
        ),
      );
    }
  } else {
    children.push(
      body(
        "No specific follow-up gaps were identified beyond the recommendations above.",
      ),
    );
  }

  if (input.caveats.length > 0) {
    children.push(label("Scope & limitations", MUTED));
    for (const caveat of input.caveats) {
      children.push(bullet(caveat));
    }
  }
  children.push(label("How this report was produced", MUTED));
  children.push(
    body(
      (input.entryPoint === "validate"
        ? "This run validated an existing report's own stated claims against the underlying evidence, rather than " +
          "mining the documents for findings from scratch. "
        : "Evidence was mined directly from the uploaded material and organised bottom-up into findings, rather " +
          "than starting from an existing report's own claims. ") +
        "Every extracted finding was checked against its source and tiered as robust, usable with caution, not " +
        "supported, or insufficient information; only findings tiered robust or usable with caution were carried " +
        "forward. Finding-level insights were then clustered by theme and triangulated across sources, so an " +
        "insight presented above as synthesized reflects agreement across more than one independent piece of " +
        "evidence, not a single observation restated. This describes how this analysis tool processed the " +
        "material, not the original research design -- see Methodology above for that.",
      { color: MUTED },
    ),
  );
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text:
            `Based only on synthesized insights and recommendations explicitly accepted as of ${generatedLabel}. ` +
            "Confidence tier reflects how well-triangulated each insight's evidence is, not how important it is.",
          italics: true,
          font: BODY_FONT,
          size: 18,
          color: MUTED,
        }),
      ],
      spacing: { before: 200 },
    }),
  );

  const doc = new Document({
    styles: {
      default: {
        heading1: {
          run: { font: DISPLAY_FONT, size: 30, bold: true, color: INK },
        },
        heading2: {
          run: { font: DISPLAY_FONT, size: 26, bold: true, color: INK },
        },
      },
    },
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
