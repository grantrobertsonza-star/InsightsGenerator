import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { withTenant } from "@/lib/db";
import { getCodingAnalysis } from "@/lib/codingAnalysis";
import {
  cooccurrence,
  themesByAttribute,
  usableAttributes,
} from "@/lib/qualCrosstab";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

type Cell = string | number | boolean | null;

function sheet(headers: string[], rows: Cell[][], widths?: number[]) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws["!cols"] = headers.map((h, i) => ({
    wch: widths?.[i] ?? Math.min(60, Math.max(12, h.length + 2)),
  }));
  return ws;
}

/**
 * The codebook and every coding check for a run as one workbook: the codes
 * with their criteria, the counts with denominators, agreement with the
 * researcher, the quote check, respondents by theme, negative cases, survey
 * links and how each file was read. One row per transcript and code, so a
 * reviewer can audit the coding without opening the app.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: runId } = await params;

  const data = await withTenant(TENANT_ID, async (client) => {
    const run = await client.query<{ project_name: string | null }>(
      "select project_name from runs where id = $1",
      [runId],
    );
    if (run.rows.length === 0) return null;
    const books = await client.query<{
      id: string;
      document_id: string;
      version: number;
      source: string;
    }>(
      `select distinct on (document_id) id, document_id, version, source
       from coding_codebooks where run_id = $1
       order by document_id, version desc`,
      [runId],
    );
    const bookIds = books.rows.map((b) => b.id);
    const docIds = books.rows.map((b) => b.document_id);
    const docs = docIds.length
      ? await client.query<{ id: string; source_filename: string }>(
          "select id, source_filename from documents where id = any($1::uuid[])",
          [docIds],
        )
      : { rows: [] as { id: string; source_filename: string }[] };
    const codes = bookIds.length
      ? await client.query<{
          id: string;
          codebook_id: string;
          name: string;
          definition: string;
          inclusion_criteria: string;
          exclusion_criteria: string;
          reproduced_runs: number | null;
          total_runs: number | null;
        }>(
          `select id, codebook_id, name, definition, inclusion_criteria, exclusion_criteria,
                  reproduced_runs, total_runs
           from coding_codes where codebook_id = any($1::uuid[]) order by position`,
          [bookIds],
        )
      : { rows: [] };
    const manifest = bookIds.length
      ? await client.query<{
          document_id: string;
          codebook_id: string | null;
          detail: Record<string, unknown>;
        }>(
          `select m.document_id, m.codebook_id, m.detail
           from coding_run_manifest m
           where m.stage = 'open_coding' and m.codebook_id = any($1::uuid[])
           order by m.created_at`,
          [bookIds],
        )
      : { rows: [] };
    return {
      project: run.rows[0].project_name,
      books: books.rows,
      docs: docs.rows,
      codes: codes.rows,
      manifest: manifest.rows,
    };
  });

  if (!data) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (data.books.length === 0) {
    return NextResponse.json(
      { error: "No codebook yet. Code themes first." },
      { status: 404 },
    );
  }

  const analysis = await getCodingAnalysis(TENANT_ID, runId);
  const fileName = new Map(data.docs.map((d) => [d.id, d.source_filename]));
  const num = (v: unknown) => (typeof v === "number" ? v : 0);

  const codebookRows: Cell[][] = [];
  for (const b of data.books) {
    const view = analysis.get(b.document_id);
    const stats = new Map(view?.codes.map((c) => [c.id, c.stats]));
    data.codes
      .filter((c) => c.codebook_id === b.id)
      .forEach((c, i) => {
        codebookRows.push([
          fileName.get(b.document_id) ?? b.document_id,
          b.version,
          view?.researcherCodeIds.includes(c.id)
            ? "Added by researcher"
            : b.source === "edited"
              ? "Edited by researcher"
              : "Induced by model",
          i + 1,
          c.name,
          c.definition,
          c.inclusion_criteria,
          c.exclusion_criteria,
          c.total_runs
            ? `${c.reproduced_runs ?? 0} of ${c.total_runs} passes`
            : null,
          stats.get(c.id)?.turns ?? null,
        ]);
      });
  }

  const countRows: Cell[][] = [];
  const agreementRows: Cell[][] = [];
  const calibrationRows: Cell[][] = [];
  const negativeRows: Cell[][] = [];
  const linkRows: Cell[][] = [];
  const dissonanceRows: Cell[][] = [];
  const readingRows: Cell[][] = [];
  const qualityRows: Cell[][] = [];
  const verbatimRows: Cell[][] = [];
  const meaningRows: Cell[][] = [];
  const changeRows: Cell[][] = [];
  const attrCrossRows: Cell[][] = [];
  const coocRows: Cell[][] = [];
  const saturationRows: Cell[][] = [];
  const attrNames = new Set<string>();
  for (const v of analysis.values())
    for (const r of v.respondents)
      for (const k of Object.keys(r.attributes)) attrNames.add(k);
  const attrList = [...attrNames].sort();
  const codeHeaders: string[] = [];

  for (const b of data.books) {
    const v = analysis.get(b.document_id);
    if (!v) continue;
    const file = fileName.get(b.document_id) ?? b.document_id;
    const focus = v.sessionType === "focus_group";
    const codeName = new Map(v.codes.map((c) => [c.id, c.name]));

    for (const c of v.codes) {
      const s = c.stats;
      countRows.push([
        file,
        c.name,
        s.turns,
        s.participantTurns,
        s.speakersWith,
        s.speakersTotal,
        s.episodes,
        focus ? s.independentSpeakers : null,
        focus ? s.echoTurns : null,
        focus && c.groups ? c.groups.with : null,
        focus && c.groups ? c.groups.total : null,
      ]);
      const a = c.agreement;
      agreementRows.push([
        file,
        c.name,
        a ? a.counts.n : 0,
        a ? a.counts.bothYes : null,
        a ? a.counts.modelOnly : null,
        a ? a.counts.researcherOnly : null,
        a ? a.counts.bothNo : null,
        a?.counts.agreement ?? null,
        a?.counts.kappa ?? null,
        a ? a.band : "Not checked",
        a?.caveat ?? null,
      ]);
      for (const n of c.negativeCases) {
        negativeRows.push([
          file,
          c.name,
          n.speaker,
          n.index,
          n.text,
          n.reason,
          n.status,
          n.assignedToCode ? "Yes" : "No",
        ]);
      }
    }

    if (v.calibration) {
      for (const t of v.calibration.turns) {
        calibrationRows.push([
          file,
          t.index,
          t.speaker,
          t.text,
          t.reviewed ? "Reviewed" : "Not reviewed",
          t.reviewed
            ? t.researcherCodeIds.map((i) => codeName.get(i) ?? i).join("; ")
            : null,
          t.reviewed
            ? t.modelCodeIds.map((i) => codeName.get(i) ?? i).join("; ")
            : null,
        ]);
      }
    }

    for (const c of v.codes)
      if (!codeHeaders.includes(c.name)) codeHeaders.push(c.name);

    for (const l of v.links) {
      linkRows.push([
        file,
        l.codeName,
        l.variable,
        l.direction,
        l.rationale,
        l.status,
        l.source,
      ]);
    }
    for (const d of v.dissonance?.flags ?? []) {
      dissonanceRows.push([
        file,
        d.respondent,
        d.codeName,
        d.variable,
        d.value,
        d.median,
        d.direction,
      ]);
    }

    for (const vb of v.verbatims) {
      for (const cid of vb.codeIds) {
        verbatimRows.push([
          file,
          codeName.get(cid) ?? cid,
          vb.group,
          vb.speaker,
          vb.index + 1,
          vb.page,
          vb.text.trim(),
          vb.codeIds
            .filter((o) => o !== cid)
            .map((o) => codeName.get(o) ?? o)
            .join("; ") || null,
          vb.researcherCodeIds.includes(cid) ? "Researcher" : "Model",
          `v${v.version}`,
        ]);
      }
    }
    for (const c of v.codes) {
      const m = v.meaningChecks[c.id];
      if (!m) continue;
      if (m.dimensions.length === 0) {
        meaningRows.push([
          file,
          c.name,
          m.verdict,
          m.earlyTurns,
          m.lateTurns,
          null,
          null,
          null,
        ]);
      }
      for (const d of m.dimensions) {
        meaningRows.push([
          file,
          c.name,
          m.verdict,
          m.earlyTurns,
          m.lateTurns,
          d.description,
          d.quote,
          `${d.speaker ?? ""}, turn ${d.turn}`,
        ]);
      }
    }
    {
      const codeList = v.codes.map((c) => ({ id: c.id, name: c.name }));
      for (const attr of usableAttributes(v.respondents)) {
        const t = themesByAttribute(v.respondents, codeList, attr);
        for (const row of t.rows) {
          t.groups.forEach((g, i) => {
            const cell = row.cells[i];
            attrCrossRows.push([
              file,
              attr,
              g.value,
              row.codeName,
              cell.withTheme,
              cell.base,
              cell.share,
              cell.turns,
              g.small ? "Yes" : "No",
            ]);
          });
        }
      }
      const co = cooccurrence(
        v.respondents,
        codeList,
        v.verbatims.map((x) => x.codeIds),
      );
      co.codes.forEach((a, i) =>
        co.codes.forEach((b, j) => {
          if (j < i) return;
          coocRows.push([
            file,
            a.name,
            b.name,
            co.pairs[i][j],
            co.turnPairs[i][j],
            co.respondents,
          ]);
        }),
      );
    }
    for (const o of v.overrides) {
      changeRows.push([
        file,
        o.createdAt,
        o.action === "add" ? "Added theme" : "Removed theme",
        o.codeName,
        o.speaker,
        o.index >= 0 ? o.index + 1 : null,
        o.text.trim(),
      ]);
    }
    const dq = v.quality;
    const stat = (label: string, value: Cell) =>
      qualityRows.push([file, label, value]);
    stat("Respondents", dq.respondents);
    stat("Participant turns", dq.participantTurns);
    stat("Moderator turns", dq.moderatorTurns);
    stat("Unlabelled turns", dq.unlabelledTurns);
    stat("Participant words", dq.participantWords);
    stat("Moderator word share", dq.moderatorWordShare);
    stat("Words per respondent, median", dq.wordsPerRespondent?.median ?? null);
    stat("Words per respondent, minimum", dq.wordsPerRespondent?.min ?? null);
    stat("Words per respondent, maximum", dq.wordsPerRespondent?.max ?? null);
    stat("Words per turn, median", dq.wordsPerTurn?.median ?? null);
    stat("Sentences per turn, mean", dq.sentencesPerTurn);
    stat("Top speaker word share", dq.topSpeakerShare);
    stat("Top three speakers word share", dq.topThreeShare);
    stat("Repeated turns", dq.duplicateTurns);
    stat("Share of participant turns coded", dq.codedShare);
    stat(
      "Cut before open coding",
      dq.truncated === null ? "Not recorded" : dq.truncated ? "Yes" : "No",
    );
    stat(
      "Respondents with under 50 words",
      dq.thinRespondents.map((r) => `${r.label} (${r.words})`).join("; ") ||
        null,
    );
    stat(
      "Themes held by fewer than 3 people",
      dq.thinThemes
        .map((t) => `${t.codeName} (${t.participants})`)
        .join("; ") || null,
    );
    if (dq.saturation) {
      const sat = dq.saturation;
      sat.order.forEach((resp, i) =>
        saturationRows.push([
          file,
          i + 1,
          resp,
          sat.newCodesPerRespondent[i],
          sat.cumulativeCodes[i],
          sat.permuted?.median[i] ?? null,
          sat.permuted?.low[i] ?? null,
          sat.permuted?.high[i] ?? null,
        ]),
      );
      if (sat.simple) {
        stat("Simple rule: themes in first respondents", sat.simple.baseCodes);
        stat(
          "Simple rule: new themes in next respondents",
          sat.simple.newInRun,
        );
        stat("Simple rule: share new (threshold 5%)", sat.simple.ratio);
      }
    }
    for (const n of dq.notes) stat("Note", n);

    const r = v.reading;
    readingRows.push([
      file,
      v.sessionType === "focus_group" ? "Focus group" : "Individual interview",
      r.requested,
      r.resolved,
      r.summary.respondents,
      r.summary.participantTurns,
      r.summary.moderatorTurns,
      r.summary.unlabelledTurns,
      r.moderators.join("; "),
      r.summary.warnings.join(" | "),
    ]);
  }

  // Respondent by theme: one column per theme with turn counts.
  const matrixHeaders = [
    "Transcript",
    "Respondent",
    "Survey match key",
    "Participant turns",
    ...attrList,
    "Matched to survey",
    ...codeHeaders,
  ];
  const matrixOut: Cell[][] = [];
  for (const b of data.books) {
    const v = analysis.get(b.document_id);
    if (!v) continue;
    const file = fileName.get(b.document_id) ?? b.document_id;
    for (const r of v.respondents) {
      const byName = new Map(
        v.codes.map((c) => [c.name, r.codeTurns[c.id] ?? 0]),
      );
      matrixOut.push([
        file,
        r.label,
        r.caseKey,
        r.turns,
        ...attrList.map((k) => r.attributes[k] ?? null),
        r.matched === null ? null : r.matched ? "Yes" : "No",
        ...codeHeaders.map((h) =>
          byName.has(h) ? (byName.get(h) as number) : null,
        ),
      ]);
    }
  }

  const quoteRows: Cell[][] = [];
  const droppedRows: Cell[][] = [];
  const passCount = new Map<string, number>();
  for (const m of data.manifest) {
    const pass = (passCount.get(m.document_id) ?? 0) + 1;
    passCount.set(m.document_id, pass);
    const file = fileName.get(m.document_id) ?? m.document_id;
    const q = (m.detail.quotes ?? {}) as Record<string, unknown>;
    quoteRows.push([
      file,
      pass,
      num(m.detail.themes_returned),
      num(m.detail.themes_kept),
      num(q.exact),
      num(q.near),
      num(q.none),
      num(q.moderator),
      m.detail.input_truncated === true ? "Yes" : "No",
    ]);
    if (Array.isArray(m.detail.dropped_themes)) {
      for (const d of m.detail.dropped_themes as {
        theme?: unknown;
        quote?: unknown;
        reason?: unknown;
      }[]) {
        droppedRows.push([
          file,
          pass,
          String(d.theme ?? ""),
          String(d.reason ?? ""),
          String(d.quote ?? ""),
        ]);
      }
    }
  }

  const wb = XLSX.utils.book_new();
  const add = (name: string, ws: XLSX.WorkSheet) =>
    XLSX.utils.book_append_sheet(wb, ws, name);
  add(
    "Codebook",
    sheet(
      [
        "Transcript",
        "Version",
        "Source",
        "Code no.",
        "Code",
        "Definition",
        "Code when",
        "Do not code when",
        "Found in",
        "Turns coded",
      ],
      codebookRows,
      [28, 8, 20, 8, 34, 60, 60, 60, 16, 12],
    ),
  );
  add(
    "Counts",
    sheet(
      [
        "Transcript",
        "Code",
        "Turns with code",
        "All participant turns",
        "Participants with code",
        "All participants",
        "Episodes",
        "Independent participants (focus groups)",
        "Echo turns (focus groups)",
        "Groups with code",
        "Groups coded",
      ],
      countRows,
      [28, 34, 12, 14, 14, 12, 10, 18, 14, 12, 12],
    ),
  );
  add(
    "Agreement",
    sheet(
      [
        "Transcript",
        "Code",
        "Turns checked",
        "Both coded",
        "Model only",
        "Researcher only",
        "Neither",
        "Agreement",
        "Cohen's kappa",
        "Band",
        "Caveat",
      ],
      agreementRows,
      [28, 34, 12, 10, 10, 14, 10, 12, 12, 16, 60],
    ),
  );
  add(
    "Calibration turns",
    sheet(
      [
        "Transcript",
        "Turn",
        "Speaker",
        "Text",
        "Status",
        "Researcher codes",
        "Model codes",
      ],
      calibrationRows,
      [28, 8, 14, 80, 14, 40, 40],
    ),
  );
  add(
    "Quote check",
    sheet(
      [
        "Transcript",
        "Pass",
        "Themes proposed",
        "Themes kept",
        "Quotes word for word",
        "Quotes close",
        "Quotes not found",
        "Quotes from moderator",
        "Input truncated",
      ],
      quoteRows,
    ),
  );
  add(
    "Dropped themes",
    sheet(
      ["Transcript", "Pass", "Theme", "Reason", "Model's quote"],
      droppedRows,
      [28, 8, 40, 40, 80],
    ),
  );
  add("Respondents by theme", sheet(matrixHeaders, matrixOut));
  add(
    "Negative cases",
    sheet(
      [
        "Transcript",
        "Code",
        "Speaker",
        "Turn",
        "Text",
        "Why it may not fit",
        "Status",
        "Coded to theme",
      ],
      negativeRows,
      [28, 34, 14, 8, 80, 50, 12, 12],
    ),
  );
  add(
    "Survey links",
    sheet(
      [
        "Transcript",
        "Code",
        "Survey variable",
        "Direction",
        "Rationale",
        "Status",
        "Source",
      ],
      linkRows,
      [28, 34, 24, 10, 60, 12, 12],
    ),
  );
  add(
    "Dissonance flags",
    sheet(
      [
        "Transcript",
        "Respondent",
        "Code",
        "Survey variable",
        "Answer",
        "Median",
        "Expected direction",
      ],
      dissonanceRows,
    ),
  );
  add(
    "Verbatim by theme",
    sheet(
      [
        "Transcript",
        "Theme",
        "Group or session",
        "Speaker",
        "Turn",
        "Page",
        "Verbatim (whole turn)",
        "Also coded as",
        "Assigned by",
        "Codebook version",
      ],
      verbatimRows,
      [28, 34, 18, 22, 8, 8, 100, 40, 12, 10],
    ),
  );
  add(
    "Meaning check",
    sheet(
      [
        "Transcript",
        "Theme",
        "Result",
        "Earlier turns",
        "Later turns",
        "New dimension",
        "Verbatim excerpt",
        "Source",
      ],
      meaningRows,
      [28, 34, 16, 10, 10, 60, 80, 24],
    ),
  );
  add(
    "Themes by attribute",
    sheet(
      [
        "Transcript",
        "Attribute",
        "Group",
        "Theme",
        "Respondents with theme",
        "Respondents in group",
        "Share",
        "Coded turns",
        "Small group (under 5)",
      ],
      attrCrossRows,
      [28, 18, 18, 34, 14, 14, 10, 12, 14],
    ),
  );
  add(
    "Theme co-occurrence",
    sheet(
      [
        "Transcript",
        "Theme A",
        "Theme B",
        "Respondents with both",
        "Turns with both",
        "All respondents",
      ],
      coocRows,
      [28, 34, 34, 14, 12, 12],
    ),
  );
  add(
    "Researcher changes",
    sheet(
      ["Transcript", "When", "Change", "Theme", "Speaker", "Turn", "Turn text"],
      changeRows,
      [28, 22, 16, 34, 20, 8, 100],
    ),
  );
  add(
    "Data quality",
    sheet(["Transcript", "Measure", "Value"], qualityRows, [28, 40, 40]),
  );
  add(
    "Saturation curve",
    sheet(
      [
        "Transcript",
        "Respondent no.",
        "Respondent",
        "New themes added",
        "Themes so far",
        "Shuffled median",
        "Shuffled 10th percentile",
        "Shuffled 90th percentile",
      ],
      saturationRows,
    ),
  );
  add(
    "How files were read",
    sheet(
      [
        "Transcript",
        "Session type",
        "Reading requested",
        "Reading used",
        "Respondents",
        "Participant turns",
        "Moderator turns left out",
        "Unlabelled turns",
        "Moderators marked",
        "Warnings",
      ],
      readingRows,
      [28, 20, 16, 16, 12, 14, 14, 12, 24, 60],
    ),
  );

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const stem = (data.project ?? "project")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${stem || "project"}-codebook-and-coding-checks.xlsx"`,
    },
  });
}
