import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  BorderStyle,
} from "docx";

// Shared with the deck's own humanizeTitle/safeFileStem helpers in
// deckSlides.ts, kept as a plain local copy rather than an import so this
// report's text formatting never silently drifts if the slide deck's own
// helpers change shape for a slide-specific reason.
export function humanizeTitle(raw: string): string {
  const looksLikeSlug = /^[a-z0-9]+([A-Z][a-z0-9]*)*$/.test(raw) && /[A-Z]/.test(raw) && !raw.includes(" ");
  if (!looksLikeSlug) return raw;
  return raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

export function safeFileStem(raw: string | null | undefined, fallback: string): string {
  const base = (raw ?? "").trim() || fallback;
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;
}

const INK = "1A1A1A";
const MUTED = "595959";
const RULE = "D9D9D9";
const ACCENT = "1E2761";

const BODY_FONT = "Calibri";
const DISPLAY_FONT = "Cambria";

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1) {
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
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 1 } },
    spacing: { after: 240 },
  });
}

export type NarrativeReportPillar = {
  headline: string;
  so_what: string;
  insights: { headline: string; observation: string; implication: string }[];
};

export type NarrativeReportObjectiveItem = {
  item_kind: "objective" | "decision";
  item_text: string;
  status: "resolved" | "partial" | "gap";
  conclusion: string;
};

export type NarrativeReportRecommendation = {
  action_text: string;
  owner_role: string;
  timeline: string;
  metric: string;
  priority: "high" | "medium" | "low";
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

export type NarrativeReportInput = {
  title: string;
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
  objectiveItems: NarrativeReportObjectiveItem[];
  unmappedInsightHeadlines: string[];
  pillars: NarrativeReportPillar[];
  recommendationsIntro: string;
  recommendations: NarrativeReportRecommendation[];
  caveats: string[];
  generatedAt: string;
};

const statusLabel: Record<NarrativeReportObjectiveItem["status"], string> = {
  resolved: "Resolved",
  partial: "Partially answered",
  gap: "Gap",
};

const priorityLabel: Record<NarrativeReportRecommendation["priority"], string> = {
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

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Groups a flat list by a key, preserving first-seen key order -- used to
 * group findings by theme and documents by kind without pulling in a
 * dependency for something this small.
 */
function groupBy<T, K extends string>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
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
export async function buildNarrativeReportDocx(input: NarrativeReportInput): Promise<Buffer> {
  const children: Paragraph[] = [];

  const generatedLabel = new Date(input.generatedAt).toLocaleDateString("en-ZA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // --- Title block ---------------------------------------------------
  children.push(
    new Paragraph({
      children: [new TextRun({ text: input.title, font: DISPLAY_FONT, size: 40, bold: true, color: INK })],
      spacing: { after: 120 },
    })
  );
  if (input.decisionStatement) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: input.decisionStatement, font: BODY_FONT, size: 22, italics: true, color: MUTED })],
        spacing: { after: 80 },
      })
    );
  }
  if (input.audience) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `Prepared for: ${input.audience}`, font: BODY_FONT, size: 20, color: MUTED })],
        spacing: { after: 80 },
      })
    );
  }
  children.push(
    new Paragraph({
      children: [new TextRun({ text: `Generated ${generatedLabel}`, font: BODY_FONT, size: 18, color: MUTED })],
      spacing: { after: 320 },
    })
  );
  children.push(rule());

  // --- Executive summary ----------------------------------------------
  if (input.executiveSummary) {
    children.push(heading("Executive summary", HeadingLevel.HEADING_1));
    children.push(body(input.executiveSummary));
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
    if (input.complication) children.push(body(input.complication, { color: MUTED }));
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
          "documented in the source material supplied for this project."
      )
    );
  }
  if (input.documents.length > 0) {
    const documentsByKind = groupBy(input.documents, (doc) => doc.kind);
    const inventoryLine = Array.from(documentsByKind.entries())
      .map(([kind, docs]) => pluralize(docs.length, documentKindLabel[kind]))
      .join(", ");
    children.push(label("Source documents", MUTED));
    children.push(body(`This analysis draws on ${inventoryLine}:`, { color: MUTED }));
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
    children.push(body("No verified findings are recorded against this project yet."));
  } else {
    const findingsByTheme = groupBy(input.findings, (f) => f.theme ?? "Uncategorized");
    for (const [theme, items] of findingsByTheme) {
      children.push(label(theme, MUTED));
      for (const finding of items) {
        const tierSuffix = finding.verdict_tier ? ` (${verdictTierLabel[finding.verdict_tier]})` : "";
        children.push(bullet(`${finding.finding_text}${tierSuffix}`));
      }
    }
  }

  // --- Insights (the synthesized, cross-source argument) ------------------
  children.push(rule());
  children.push(heading("Insights", HeadingLevel.HEADING_1));
  if (input.governingThought) {
    children.push(body(input.governingThought, { italic: true, color: ACCENT }));
  }

  input.pillars.forEach((pillar, index) => {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `Theme ${index + 1} of ${input.pillars.length} — `, font: BODY_FONT, size: 21, color: ACCENT }),
          new TextRun({ text: pillar.headline, font: DISPLAY_FONT, size: 26, bold: true, color: INK }),
        ],
        spacing: { before: 320, after: 80 },
      })
    );
    if (pillar.so_what) {
      children.push(body(pillar.so_what, { italic: true, color: MUTED }));
    }
    for (const insight of pillar.insights) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: insight.headline, bold: true, font: BODY_FONT, size: 21 })],
          spacing: { before: 140, after: 40 },
        })
      );
      children.push(body(insight.observation));
      children.push(body(`“${insight.implication}”`, { italic: true, color: MUTED }));
    }
  });

  if (input.objectiveItems.length > 0) {
    children.push(heading("What this means for what you asked", HeadingLevel.HEADING_2));
    for (const item of input.objectiveItems) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `[${statusLabel[item.status]}] `,
              bold: true,
              font: BODY_FONT,
              size: 21,
              color: item.status === "resolved" ? "15803D" : item.status === "partial" ? "B45309" : MUTED,
            }),
            new TextRun({
              text: `${item.item_kind === "objective" ? "Objective" : "Decision"}: ${item.item_text}`,
              bold: true,
              font: BODY_FONT,
              size: 21,
            }),
          ],
          spacing: { before: 160, after: 40 },
        })
      );
      children.push(body(item.conclusion, { color: MUTED }));
    }

    if (input.unmappedInsightHeadlines.length > 0) {
      children.push(label("Beyond the original brief", "0F766E"));
      children.push(
        body(
          `The evidence also surfaced ${input.unmappedInsightHeadlines.length} accepted insight` +
            `${input.unmappedInsightHeadlines.length === 1 ? "" : "s"} that none of the objectives or decisions ` +
            `above asked about: ${input.unmappedInsightHeadlines.join("; ")}.`
        )
      );
    }
  }

  // --- Recommendations -----------------------------------------------
  children.push(rule());
  children.push(heading("Recommendations", HeadingLevel.HEADING_1));
  if (input.recommendationsIntro) {
    children.push(body(input.recommendationsIntro, { italic: true, color: MUTED }));
  }
  if (input.recommendations.length === 0) {
    children.push(body("No recommendations have been accepted yet."));
  }
  for (const rec of input.recommendations) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `[${priorityLabel[rec.priority]}] `, bold: true, font: BODY_FONT, size: 21, color: ACCENT }),
          new TextRun({ text: rec.action_text, bold: true, font: BODY_FONT, size: 21 }),
        ],
        spacing: { before: 160, after: 40 },
      })
    );
    children.push(body(`${rec.owner_role} · ${rec.timeline} · Success metric: ${rec.metric}`, { color: MUTED }));
  }

  // --- Next steps: gaps worth following up, plus scope & limitations -----
  children.push(rule());
  children.push(heading("Next steps", HeadingLevel.HEADING_1));
  const gapItems = input.objectiveItems.filter((item) => item.status === "gap");
  if (gapItems.length > 0 || input.recommendations.length > 0) {
    children.push(
      body(
        "Beyond acting on the recommendations above, this project points to a few specific places to follow up:"
      )
    );
    for (const item of gapItems) {
      children.push(
        bullet(
          `Further work is needed on the ${item.item_kind === "objective" ? "objective" : "decision"}: "${item.item_text}" ` +
            `-- the accepted evidence did not resolve it.`
        )
      );
    }
    if (input.recommendations.some((r) => r.priority === "high")) {
      children.push(bullet("Prioritise the high-priority recommendations above before the medium- and lower-priority ones."));
    }
  } else {
    children.push(body("No specific follow-up gaps were identified beyond the recommendations above."));
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
      { color: MUTED }
    )
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
    })
  );

  const doc = new Document({
    styles: {
      default: {
        heading1: { run: { font: DISPLAY_FONT, size: 30, bold: true, color: INK } },
        heading2: { run: { font: DISPLAY_FONT, size: 26, bold: true, color: INK } },
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
