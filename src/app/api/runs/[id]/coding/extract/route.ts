import { NextResponse } from "next/server";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { withTenant } from "@/lib/db";
import {
  getCodingAnalysis,
  type CodeAnalysis,
  type CodingAnalysisView,
} from "@/lib/codingAnalysis";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

/**
 * A working document for writing up: every transcript's themes with their
 * sub-themes (codes), the participant turns coded to each, who said it and
 * where, and the researcher's own notes. The quotes are whole turns exactly
 * as spoken, so trim to the sentence you need. This is the "themed data
 * extract" a researcher compiles by hand after coding.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: runId } = await params;
  const info = await withTenant(TENANT_ID, async (client) => {
    const run = await client.query<{ project_name: string | null }>(
      "select project_name from runs where id = $1",
      [runId],
    );
    if (run.rows.length === 0) return null;
    const docs = await client.query<{ id: string; source_filename: string }>(
      "select id, source_filename from documents where run_id = $1",
      [runId],
    );
    return { project: run.rows[0].project_name, docs: docs.rows };
  });
  if (!info)
    return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const analysis = await getCodingAnalysis(TENANT_ID, runId);
  if (analysis.size === 0)
    return NextResponse.json(
      { error: "No coding yet. Code themes first." },
      { status: 404 },
    );
  const fileName = new Map(info.docs.map((d) => [d.id, d.source_filename]));

  const children: Paragraph[] = [];
  const text = (t: string, opts: { bold?: boolean; italics?: boolean } = {}) =>
    new TextRun({ text: t, bold: opts.bold, italics: opts.italics });
  const para = (runs: TextRun[], extra: Record<string, unknown> = {}) =>
    new Paragraph({ children: runs, spacing: { after: 100 }, ...extra });

  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [text(`${info.project ?? "Project"}: themed data extract`)],
    }),
    para([
      text(
        "Participant turns grouped under the themes and sub-themes they were coded to. Quotes are whole turns, word for word; trim to the sentence that makes your point. Counts are recomputed from the transcripts. Notes in square brackets are the researcher's own.",
        { italics: true },
      ),
    ]),
  );

  const quoteParagraphs = (view: CodingAnalysisView, code: CodeAnalysis) => {
    const out: Paragraph[] = [];
    const turns = view.verbatims.filter((v) => v.codeIds.includes(code.id));
    if (turns.length === 0) {
      out.push(para([text("No turns coded.", { italics: true })]));
      return out;
    }
    for (const v of turns) {
      const who = v.speaker ?? "Unlabelled";
      const where = [v.page ? `p. ${v.page}` : null, `turn ${v.index + 1}`]
        .filter(Boolean)
        .join(", ");
      out.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 80 },
          children: [
            text(`${who} (${where}): `, { bold: true }),
            text(`“${v.text.trim()}”`),
          ],
        }),
      );
      if (v.note)
        out.push(
          new Paragraph({
            spacing: { after: 100 },
            indent: { left: 720 },
            children: [text(`[Researcher note: ${v.note}]`, { italics: true })],
          }),
        );
    }
    return out;
  };

  const countLine = (
    stats: CodeAnalysis["stats"],
  ): string => {
    const people =
      stats.speakersWith !== null && stats.speakersTotal !== null
        ? `${stats.speakersWith} of ${stats.speakersTotal} participants, `
        : "";
    return `${people}${stats.turns} of ${stats.participantTurns} participant turns`;
  };

  for (const [documentId, view] of analysis) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 360 },
        children: [text(fileName.get(documentId) ?? "Transcript")],
      }),
    );
    // Themes in order of first appearance; a code with no theme stands alone.
    const order: { theme: string; codes: CodeAnalysis[]; grouped: boolean }[] =
      [];
    for (const c of view.codes) {
      const key = c.theme ?? c.name;
      let entry = order.find((o) => o.theme.toLowerCase() === key.toLowerCase());
      if (!entry) {
        entry = { theme: key, codes: [], grouped: Boolean(c.theme) };
        order.push(entry);
      }
      entry.codes.push(c);
    }
    for (const group of order) {
      const rollup = view.themes.find((t) => t.theme === group.theme);
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240 },
          children: [text(`Theme: ${group.theme}`)],
        }),
      );
      const stats = rollup ? rollup.stats : group.codes[0].stats;
      children.push(para([text(countLine(stats), { italics: true })]));
      const themeNote = rollup?.note ?? (group.grouped ? "" : group.codes[0].note);
      if (themeNote)
        children.push(
          para([text(`[Researcher note: ${themeNote}]`, { italics: true })]),
        );
      for (const code of group.codes) {
        if (group.grouped) {
          children.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_3,
              spacing: { before: 160 },
              children: [text(`Code: ${code.name}`)],
            }),
            para([text(countLine(code.stats), { italics: true })]),
          );
          if (code.note)
            children.push(
              para([
                text(`[Researcher note: ${code.note}]`, { italics: true }),
              ]),
            );
        }
        children.push(...quoteParagraphs(view, code));
      }
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  const stem = (info.project ?? "project")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${stem || "project"}-themed-extract.docx"`,
    },
  });
}
