import { NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";
import { withTenant } from "@/lib/db";
import { addTitleSlide, addFooter, safeFileStem } from "@/lib/deckSlides";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

type ExportFinding = {
  finding_text: string;
  finding_kind: string | null;
  origin: "stated" | "generated" | "coded";
  theme: string | null;
  status: "pending" | "accepted" | "rejected";
  researcher_note: string | null;
  data_type: "qualitative" | "quantitative" | null;
};

const kindLabel: Record<string, string> = {
  fact: "Fact",
  own_finding: "Own finding",
  external_citation: "External citation",
  hypothesis: "Hypothesis",
  methodology: "Methodology",
  recommendation: "Recommendation",
  stated_insight: "Stated insight",
};

const NO_THEME_LABEL = "No theme";

/**
 * Builds a simple, client-presentable slide deck from a project's findings,
 * one slide per theme. By default (or with ?scope=accepted) this only
 * includes findings that have already been reviewed and accepted in the app,
 * since a deck handed to a client should normally reflect a human decision,
 * not everything the extraction agent proposed. Passing ?scope=all instead
 * includes every finding regardless of review status, tagging each bullet
 * with where it stands so pending/rejected items are never mistaken for
 * reviewed ones.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") === "all" ? "all" : "accepted";

  const [run, findings] = await withTenant(TENANT_ID, async (client) => {
    const runResult = await client.query<{
      project_name: string | null;
      decision_statement: string | null;
      audience: string | null;
    }>("select project_name, decision_statement, audience from runs where id = $1", [runId]);

    const findingsResult = await client.query<ExportFinding>(
      `select finding_text, finding_kind, origin, theme, status, researcher_note, data_type
       from findings
       where run_id = $1${scope === "accepted" ? " and status = 'accepted'" : ""}
       order by theme nulls last, created_at`,
      [runId]
    );
    return [runResult.rows[0], findingsResult.rows] as const;
  });

  if (!run) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";

  const title = run.project_name ?? run.decision_statement ?? "Insights Elevator";

  addTitleSlide(pptx, {
    title,
    decisionStatement: run.decision_statement,
    showDecisionLine: Boolean(run.project_name && run.decision_statement),
    audience: run.audience,
  });

  if (findings.length === 0) {
    const emptySlide = pptx.addSlide();
    emptySlide.addText(
      scope === "accepted"
        ? "No findings have been accepted yet. Review and accept findings in the app, then export again."
        : "No findings have been extracted for this project yet.",
      { x: 0.6, y: 2.3, w: 8.8, h: 1, fontSize: 16, color: "374151" }
    );
  }

  // A busy stakeholder often only reads the first slide after the title, so
  // pull the findings already marked as this report's own interpretive
  // statements or calls to action onto a takeaways slide up front. Only
  // ACCEPTED ones count as a takeaway, even in "all" scope, since a finding
  // still pending review hasn't earned a place on the headline slide yet.
  const takeaways = findings.filter(
    (finding) =>
      finding.status === "accepted" &&
      (finding.finding_kind === "stated_insight" || finding.finding_kind === "recommendation")
  );

  if (takeaways.length > 0) {
    const takeawaysSlide = pptx.addSlide();
    takeawaysSlide.addText("Key Takeaways", {
      x: 0.5,
      y: 0.35,
      w: 9,
      h: 0.6,
      fontSize: 24,
      bold: true,
      color: "1D4ED8",
    });
    takeawaysSlide.addText(
      takeaways.flatMap((finding) => {
        const bullet = {
          text: finding.finding_text,
          options: { bullet: true, breakLine: true },
        };
        if (!finding.researcher_note) return [bullet];
        return [
          bullet,
          {
            text: `Note: ${finding.researcher_note}`,
            options: { bullet: false, breakLine: true, indentLevel: 1, italic: true, color: "6B7280", fontSize: 12 },
          },
        ];
      }),
      { x: 0.5, y: 1.1, w: 9, h: 4, fontSize: 16, color: "111827", valign: "top" }
    );
  }

  const grouped = new Map<string, ExportFinding[]>();
  for (const finding of findings) {
    const key = finding.theme ?? NO_THEME_LABEL;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(finding);
  }

  // One accent color per kind so a reader can tell a fact from a
  // recommendation from a stated insight at a glance, without reading the
  // small label on every card.
  const kindColor: Record<string, string> = {
    fact: "64748B",
    own_finding: "2563EB",
    external_citation: "7C3AED",
    hypothesis: "D97706",
    methodology: "6B7280",
    recommendation: "16A34A",
    stated_insight: "4F46E5",
  };
  const GENERATED_COLOR = "0EA5E9";

  const CARDS_PER_ROW = 2;
  const CARDS_PER_COL = 3;
  const CARDS_PER_SLIDE = CARDS_PER_ROW * CARDS_PER_COL;
  const CARD_W = 4.4;
  const CARD_H = 1.35;
  const CARD_GAP_X = 0.2;
  const CARD_GAP_Y = 0.15;
  const GRID_X = 0.5;
  const GRID_Y = 1.05;

  const deckTitle = run.project_name ?? run.decision_statement ?? "Insights Elevator";


  for (const [theme, themeFindings] of grouped) {
    const pageCount = Math.max(1, Math.ceil(themeFindings.length / CARDS_PER_SLIDE));

    for (let page = 0; page < pageCount; page++) {
      const slide = pptx.addSlide();
      const pageFindings = themeFindings.slice(page * CARDS_PER_SLIDE, (page + 1) * CARDS_PER_SLIDE);

      slide.addText(pageCount > 1 ? `${theme} (${page + 1}/${pageCount})` : theme, {
        x: 0.5,
        y: 0.35,
        w: 9,
        h: 0.55,
        fontSize: 22,
        bold: true,
        color: "1D4ED8",
      });

      pageFindings.forEach((finding, index) => {
        const col = index % CARDS_PER_ROW;
        const row = Math.floor(index / CARDS_PER_ROW);
        const x = GRID_X + col * (CARD_W + CARD_GAP_X);
        const y = GRID_Y + row * (CARD_H + CARD_GAP_Y);
        const accent = finding.finding_kind
          ? (kindColor[finding.finding_kind] ?? "6B7280")
          : finding.origin === "generated"
            ? GENERATED_COLOR
            : "6B7280";

        slide.addShape("roundRect", {
          x,
          y,
          w: CARD_W,
          h: CARD_H,
          rectRadius: 0.06,
          fill: { color: "F8FAFC" },
          line: { color: "E2E8F0", width: 0.75 },
        });
        // A thin accent bar down the left edge of the card, doubling as the
        // color key for the kind badge above the finding text.
        slide.addShape("rect", { x, y, w: 0.06, h: CARD_H, fill: { color: accent }, line: { type: "none" } });

        const label = finding.finding_kind
          ? (kindLabel[finding.finding_kind] ?? finding.finding_kind)
          : finding.origin === "generated"
            ? "Generated finding"
            : "Finding";
        const statusTag =
          scope === "all" && finding.status !== "accepted"
            ? finding.status === "rejected"
              ? " · Rejected"
              : " · Pending review"
            : "";
        const dataTypeTag =
          finding.data_type === "qualitative" ? " · Qual" : finding.data_type === "quantitative" ? " · Quant" : "";

        slide.addText(`${label.toUpperCase()}${dataTypeTag}${statusTag}`, {
          x: x + 0.15,
          y: y + 0.08,
          w: CARD_W - 0.3,
          h: 0.22,
          fontSize: 9,
          bold: true,
          color: accent,
          charSpacing: 1,
        });

        const bodyLines = finding.researcher_note
          ? [
              { text: finding.finding_text, options: { fontSize: 11.5, color: "111827", breakLine: true } },
              {
                text: `Note: ${finding.researcher_note}`,
                options: { fontSize: 9.5, italic: true, color: "6B7280" },
              },
            ]
          : [{ text: finding.finding_text, options: { fontSize: 11.5, color: "111827" } }];

        slide.addText(bodyLines, {
          x: x + 0.15,
          y: y + 0.32,
          w: CARD_W - 0.3,
          h: CARD_H - 0.4,
          valign: "top",
          autoFit: true,
        });
      });

      addFooter(slide, deckTitle, `${theme} · ${page + 1}/${pageCount}`);
    }
  }

  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

  const safeName = safeFileStem(run.project_name ?? run.decision_statement ?? "insights", "insights");

  const suffix = scope === "accepted" ? "accepted-deck" : "deck";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${safeName}-${suffix}.pptx"`,
    },
  });
}
