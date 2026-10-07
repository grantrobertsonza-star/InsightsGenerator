import type { PoolClient } from "pg";
import {
  applyOverrides,
  carryResearcherFlags,
  codeKey,
  loadOverrides,
} from "./codingOverrides";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import {
  archiveAndReplaceFindings,
  type ArchiveReason,
} from "./findingArchive";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { mapWithConcurrency } from "./concurrency";
import { extractDocumentText } from "./extractFindings";
import {
  MAX_CODES,
  buildApplyBatches,
  buildPageIndex,
  matchQuote,
  pageForSegment,
  parseAssignments,
  pickExemplar,
  segmentTranscriptDetailed,
  type SegmentMode,
  type SegmentationResult,
  sha256,
  tallyQuoteMatches,
  validateConsolidation,
  type ConsolidatedCode,
  type QuoteMatch,
  type RunTheme,
  type TranscriptSegment,
} from "./qualCoding";

/**
 * Agent 1's qualitative counterpart to extractFindingsFromDocument. A raw
 * transcript (an interview or focus group, say) doesn't assert findings the
 * way a written report does, so this codes it the way a qualitative
 * researcher would, in four steps, each of which leaves a record:
 *
 *  1. Open coding, run OPEN_CODING_RUNS times. One model pass names themes,
 *     but a second pass over the same text can name different ones, and a
 *     single run cannot show that. Each theme's quote is checked against the
 *     transcript's participant turns; a theme whose quote is not really
 *     there is dropped before anything is merged.
 *  2. Consolidation. The runs' themes are merged into a codebook: a name, a
 *     definition and inclusion and exclusion criteria for each code, plus
 *     how many of the runs found it. That count is computed here from the
 *     merge, not asserted by the model.
 *  3. Application. The codebook is applied to every participant turn of the
 *     whole transcript, not just the stretch the open runs saw. The
 *     codebook is versioned and a researcher can edit it and re-apply it
 *     (reapplyCodebook below).
 *  4. Findings. Each code applied to at least two turns becomes a finding
 *     tagged 'coded', its quote taken from a participant turn the code was
 *     actually applied to, so it is verbatim by construction.
 *
 * Every model call is written to coding_run_manifest with a hash of its
 * instructions and of the text it was given.
 */

// Three runs is the smallest number that shows whether a theme is stable
// (found in all, some or one), and it triples the cost of the open pass.
export const OPEN_CODING_RUNS = 3;

// How much of the transcript an open coding run is shown. Longer transcripts
// are cut at a turn boundary and the cut is recorded, but the codebook is
// still applied to the whole transcript in step 3.
const OPEN_CODING_MAX_CHARS = 60000;

const MIN_SEGMENTS_FOR_FINDING = 2;
const MODEL_CONCURRENCY = 3;

type StoredSegment = TranscriptSegment & { id: string; page: number | null };

type CodeRow = {
  id: string;
  position: number;
  name: string;
  definition: string;
  inclusion: string;
  exclusion: string;
  reproducedRuns: number | null;
  totalRuns: number | null;
};

export type CodebookEdit = {
  id: string | null;
  name: string;
  definition: string;
  inclusion: string;
  exclusion: string;
};

export type ManifestStage =
  | "open_coding"
  | "consolidation"
  | "apply"
  | "summary"
  | "link_proposal"
  | "negative_case_search";

export async function recordManifest(
  tenantId: string,
  runId: string,
  documentId: string,
  row: {
    stage: ManifestStage;
    runIndex: number;
    promptHash: string;
    inputHash: string;
    detail: Record<string, unknown>;
    codebookId?: string | null;
  },
): Promise<string | null> {
  try {
    return await withTenant(tenantId, async (client) => {
      const result = await client.query<{ id: string }>(
        `insert into coding_run_manifest
           (tenant_id, run_id, document_id, codebook_id, stage, run_index, model, prompt_hash, input_hash, detail)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         returning id`,
        [
          tenantId,
          runId,
          documentId,
          row.codebookId ?? null,
          row.stage,
          row.runIndex,
          CLAUDE_MODEL,
          row.promptHash,
          row.inputHash,
          JSON.stringify(row.detail),
        ],
      );
      return result.rows[0].id;
    });
  } catch {
    // Bookkeeping only: losing a manifest row is never worth failing a run.
    return null;
  }
}

async function recordTrace(
  tenantId: string,
  runId: string,
  event: string,
  detail: Record<string, unknown>,
) {
  try {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, $3, $4)`,
        [tenantId, runId, event, JSON.stringify(detail)],
      );
    });
  } catch {
    // Same reasoning as recordManifest.
  }
}

// --- Step 1: open coding ------------------------------------------------

const OPEN_SYSTEM =
  "You are doing a thematic analysis of a raw qualitative transcript (an interview, a focus group, " +
  "or similar verbatim dialogue), not reading a polished report. Nothing in this text is already " +
  "stated as a finding, so your job is to read it the way a qualitative researcher would: first " +
  "notice the recurring ideas, reactions, and concerns that come up (open coding), then group those " +
  "into a small number of coherent themes (axial coding).\n\n" +
  "Lines may start with a speaker label. Moderator or interviewer turns are context only: a theme " +
  "must come from what participants said, and its quote must be a participant's words.\n\n" +
  "For each theme, write:\n" +
  "- theme: a short theme name (two to five words), the same kind of label used elsewhere in this " +
  'app, e.g. "Trust in customer service", "Price sensitivity".\n' +
  "- finding_text: one or two sentences stating what this theme is and what the transcript shows " +
  'about it, written as a finding ("Participants repeatedly described..."), not as a quote.\n' +
  "- illustrative_quote: the single most representative verbatim excerpt from a participant, copied " +
  "exactly as it appears, within one turn, not paraphrased and not joined from several turns.\n\n" +
  "Only identify themes that are genuinely supported by multiple points in the text, not a single " +
  "passing remark. Aim for roughly four to eight themes, not one per sentence. Do not invent themes " +
  "the transcript does not support.";

const OPEN_TOOLS = [
  {
    name: "record_themes",
    description:
      "Records the themes identified in the transcript through thematic coding.",
    input_schema: {
      type: "object" as const,
      properties: {
        themes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              theme: { type: "string", description: "A short theme name." },
              finding_text: {
                type: "string",
                description:
                  "What this theme is and what the transcript shows about it, stated as a finding.",
              },
              illustrative_quote: {
                type: "string",
                description:
                  "The single most representative verbatim excerpt from one participant turn.",
              },
            },
            required: ["theme", "finding_text", "illustrative_quote"],
          },
        },
      },
      required: ["themes"],
    },
  },
];

function buildOpenExcerpt(segments: TranscriptSegment[]): {
  text: string;
  truncated: boolean;
} {
  const lines: string[] = [];
  let used = 0;
  let truncated = false;
  for (const segment of segments) {
    const line = segment.speaker
      ? `${segment.speaker}: ${segment.text}`
      : segment.text;
    if (used + line.length + 1 > OPEN_CODING_MAX_CHARS) {
      truncated = true;
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return { text: lines.join("\n"), truncated };
}

type OpenRunResult = {
  runIndex: number;
  themes: RunTheme[];
  tally: ReturnType<typeof tallyQuoteMatches>;
  dropped: number;
  manifestId: string | null;
};

async function runOpenCoding(
  tenantId: string,
  runId: string,
  documentId: string,
  segments: TranscriptSegment[],
  excerpt: string,
  runIndex: number,
  truncated: boolean,
): Promise<OpenRunResult | null> {
  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      system: OPEN_SYSTEM,
      tool_choice: { type: "tool", name: "record_themes" },
      tools: OPEN_TOOLS,
      messages: [
        { role: "user", content: `Here is the transcript text:\n\n${excerpt}` },
      ],
    });
    await logApiUsage(tenantId, runId, "extract_themes", response.usage);

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (
      !toolUse ||
      toolUse.type !== "tool_use" ||
      response.stop_reason === "max_tokens"
    )
      return null;
    const raw = (toolUse.input as { themes?: unknown }).themes;
    if (!Array.isArray(raw)) return null;

    const matches: QuoteMatch[] = [];
    const kept: RunTheme[] = [];
    let dropped = 0;
    const droppedThemes: { theme: string; quote: string; reason: string }[] = [];
    for (const item of raw as Partial<RunTheme>[]) {
      if (
        typeof item?.theme !== "string" ||
        !item.theme.trim() ||
        typeof item.finding_text !== "string" ||
        !item.finding_text.trim() ||
        typeof item.illustrative_quote !== "string" ||
        !item.illustrative_quote.trim()
      ) {
        continue;
      }
      const match = matchQuote(item.illustrative_quote, segments);
      matches.push(match);
      // A theme stays only if its quote is verbatim, in one participant
      // turn. A near match, a quote found only in moderator words, and a
      // quote that is not in the transcript at all are all dropped here.
      if (match.match === "exact" && match.role !== "moderator") {
        kept.push({
          theme: item.theme.trim(),
          finding_text: item.finding_text.trim(),
          illustrative_quote: item.illustrative_quote.trim(),
        });
      } else {
        dropped += 1;
        droppedThemes.push({
          theme: item.theme.trim(),
          quote: item.illustrative_quote.trim().slice(0, 300),
          reason:
            match.match === "exact"
              ? "quote came from the moderator"
              : match.match === "near"
                ? "quote was close but not word for word"
                : "quote was not found in the transcript",
        });
      }
    }
    const tally = tallyQuoteMatches(matches);
    const manifestId = await recordManifest(tenantId, runId, documentId, {
      stage: "open_coding",
      runIndex,
      promptHash: sha256(OPEN_SYSTEM + JSON.stringify(OPEN_TOOLS)),
      inputHash: sha256(excerpt),
      detail: {
        themes_returned: matches.length,
        themes_kept: kept.length,
        quotes: tally,
        input_truncated: truncated,
        stop_reason: response.stop_reason,
        dropped_themes: droppedThemes,
      },
    });
    return { runIndex, themes: kept, tally, dropped, manifestId };
  } catch {
    return null;
  }
}

// --- Step 2: consolidation ---------------------------------------------

const CONSOLIDATE_SYSTEM =
  "You are building a codebook from the themes found in several independent coding passes over the " +
  "same transcript. Themes in different passes that describe the same idea must become one code; " +
  "themes that are genuinely different stay separate. Do not add an idea no pass found.\n\n" +
  "For each code write:\n" +
  "- name: a short name (two to five words).\n" +
  "- definition: one or two sentences that stand alone, so someone who has not seen the transcript " +
  "could decide whether a given remark belongs to the code.\n" +
  "- inclusion_criteria: when a remark should be coded here.\n" +
  "- exclusion_criteria: what looks similar but should not be coded here, naming the nearest other " +
  "code where there is one.\n" +
  "- members: every theme that was merged into the code, as { run, theme } using the 1-based run and " +
  "theme numbers shown. Every theme should appear in exactly one code.\n\n" +
  `Produce at most ${MAX_CODES} codes.`;

const CONSOLIDATE_TOOLS = [
  {
    name: "record_codebook",
    description: "Records the merged codebook.",
    input_schema: {
      type: "object" as const,
      properties: {
        codes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              definition: { type: "string" },
              inclusion_criteria: { type: "string" },
              exclusion_criteria: { type: "string" },
              members: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    run: { type: "integer" },
                    theme: { type: "integer" },
                  },
                  required: ["run", "theme"],
                },
              },
            },
            required: [
              "name",
              "definition",
              "inclusion_criteria",
              "exclusion_criteria",
              "members",
            ],
          },
        },
      },
      required: ["codes"],
    },
  },
];

async function consolidate(
  tenantId: string,
  runId: string,
  documentId: string,
  runs: OpenRunResult[],
): Promise<{ codes: ConsolidatedCode[]; manifestId: string | null }> {
  const themesPerRun = runs.map((r) => r.themes.length);
  const input = runs
    .map(
      (r, i) =>
        `Pass ${i + 1}:\n` +
        r.themes
          .map((t, j) => `  ${j + 1}. ${t.theme}: ${t.finding_text}`)
          .join("\n"),
    )
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8000,
    system: CONSOLIDATE_SYSTEM,
    tool_choice: { type: "tool", name: "record_codebook" },
    tools: CONSOLIDATE_TOOLS,
    messages: [{ role: "user", content: input }],
  });
  await logApiUsage(tenantId, runId, "codebook_consolidation", response.usage);

  const toolUse = response.content.find((block) => block.type === "tool_use");
  const raw =
    toolUse && toolUse.type === "tool_use"
      ? (toolUse.input as { codes?: unknown }).codes
      : null;
  const codes = validateConsolidation(raw, themesPerRun);
  const manifestId = await recordManifest(tenantId, runId, documentId, {
    stage: "consolidation",
    runIndex: 0,
    promptHash: sha256(CONSOLIDATE_SYSTEM + JSON.stringify(CONSOLIDATE_TOOLS)),
    inputHash: sha256(input),
    detail: {
      runs: runs.length,
      themes_in: themesPerRun.reduce((a, b) => a + b, 0),
      codes_out: codes.length,
    },
  });
  return { codes, manifestId };
}

// --- Step 3: applying the codebook --------------------------------------

const APPLY_SYSTEM =
  "You apply a codebook to the turns of a qualitative transcript. For each numbered turn, list the " +
  "codes it clearly expresses, using the code numbers. A turn may fit more than one code or none. " +
  'Judge only what the participant actually said in that turn. A short reply such as "yes" or ' +
  '"same for me" is coded only if the question shown as context makes its meaning clear, and an ' +
  "exclusion criterion always wins over an inclusion criterion. Leave out turns that fit no code.";

const APPLY_TOOLS = [
  {
    name: "record_assignments",
    description: "Records which codes apply to which turns.",
    input_schema: {
      type: "object" as const,
      properties: {
        assignments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: {
                type: "integer",
                description: "The turn number as shown.",
              },
              codes: { type: "array", items: { type: "integer" } },
            },
            required: ["index", "codes"],
          },
        },
      },
      required: ["assignments"],
    },
  },
];

function codebookBlock(codes: CodeRow[]): string {
  return codes
    .map(
      (c, i) =>
        `${i + 1}. ${c.name}\n   Definition: ${c.definition}` +
        (c.inclusion ? `\n   Code when: ${c.inclusion}` : "") +
        (c.exclusion ? `\n   Do not code when: ${c.exclusion}` : ""),
    )
    .join("\n");
}

async function applyCodebook(
  tenantId: string,
  runId: string,
  documentId: string,
  codebookId: string,
  codes: CodeRow[],
  segments: StoredSegment[],
): Promise<{
  assignments: Map<number, number[]>;
  failedBatches: number;
  totalBatches: number;
}> {
  const batches = buildApplyBatches(segments);
  const block = codebookBlock(codes);
  const results = await mapWithConcurrency(
    batches,
    MODEL_CONCURRENCY,
    async (batch, batchIndex) => {
      try {
        const turns = batch.items
          .map(
            (item) =>
              `[${item.index}] ` +
              (item.context ? `(question asked: "${item.context}") ` : "") +
              item.text,
          )
          .join("\n");
        const user = `Codebook:\n${block}\n\nTurns:\n${turns}`;
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 8000,
          system: APPLY_SYSTEM,
          tool_choice: { type: "tool", name: "record_assignments" },
          tools: APPLY_TOOLS,
          messages: [{ role: "user", content: user }],
        });
        await logApiUsage(tenantId, runId, "codebook_apply", response.usage);
        const toolUse = response.content.find((b) => b.type === "tool_use");
        if (
          !toolUse ||
          toolUse.type !== "tool_use" ||
          response.stop_reason === "max_tokens"
        )
          return null;
        const parsed = parseAssignments(
          (toolUse.input as { assignments?: unknown }).assignments,
          new Set(batch.items.map((i) => i.index)),
          codes.length,
        );
        await recordManifest(tenantId, runId, documentId, {
          codebookId,
          stage: "apply",
          runIndex: batchIndex,
          promptHash: sha256(APPLY_SYSTEM + JSON.stringify(APPLY_TOOLS)),
          inputHash: sha256(user),
          detail: { turns: batch.items.length, turns_coded: parsed.size },
        });
        return parsed;
      } catch {
        return null;
      }
    },
  );

  const merged = new Map<number, number[]>();
  let failed = 0;
  for (const result of results) {
    if (!result) {
      failed += 1;
      continue;
    }
    for (const [index, assigned] of result) merged.set(index, assigned);
  }
  return {
    assignments: merged,
    failedBatches: failed,
    totalBatches: batches.length,
  };
}

// --- Step 4: findings ---------------------------------------------------

const SUMMARY_SYSTEM =
  "For each code below you are shown the transcript turns it was applied to. Write one or two " +
  'sentences stating what those turns show about the code, as a finding ("Participants described ..."). ' +
  "Say only what the turns support. If they disagree with one another, say so. Do not give counts or " +
  "percentages and do not quote.";

const SUMMARY_TOOLS = [
  {
    name: "record_summaries",
    description: "Records one finding statement per code.",
    input_schema: {
      type: "object" as const,
      properties: {
        summaries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: {
                type: "integer",
                description: "The code number as shown.",
              },
              finding_text: { type: "string" },
            },
            required: ["code", "finding_text"],
          },
        },
      },
      required: ["summaries"],
    },
  },
];

function spread<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const out: T[] = [];
  for (let i = 0; i < count; i++)
    out.push(items[Math.floor((i * items.length) / count)]);
  return out;
}

async function summarise(
  tenantId: string,
  runId: string,
  documentId: string,
  codebookId: string,
  codes: CodeRow[],
  turnsByCode: Map<number, StoredSegment[]>,
): Promise<Map<number, string>> {
  const eligible = codes
    .map((_, i) => i + 1)
    .filter(
      (n) => (turnsByCode.get(n)?.length ?? 0) >= MIN_SEGMENTS_FOR_FINDING,
    );
  const out = new Map<number, string>();
  if (eligible.length === 0) return out;

  const user = eligible
    .map((n) => {
      const code = codes[n - 1];
      const shown = spread(turnsByCode.get(n) ?? [], 6)
        .map(
          (s) =>
            `   - ${s.speaker ? `${s.speaker}: ` : ""}${s.text.slice(0, 400)}`,
        )
        .join("\n");
      return `Code ${n}: ${code.name}\nDefinition: ${code.definition}\nTurns:\n${shown}`;
    })
    .join("\n\n");

  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system: SUMMARY_SYSTEM,
      tool_choice: { type: "tool", name: "record_summaries" },
      tools: SUMMARY_TOOLS,
      messages: [{ role: "user", content: user }],
    });
    await logApiUsage(tenantId, runId, "codebook_summary", response.usage);
    const toolUse = response.content.find((b) => b.type === "tool_use");
    const raw =
      toolUse && toolUse.type === "tool_use"
        ? (toolUse.input as { summaries?: unknown }).summaries
        : null;
    if (Array.isArray(raw)) {
      for (const item of raw as { code?: unknown; finding_text?: unknown }[]) {
        if (
          typeof item?.code === "number" &&
          eligible.includes(item.code) &&
          typeof item.finding_text === "string" &&
          item.finding_text.trim()
        ) {
          out.set(item.code, item.finding_text.trim());
        }
      }
    }
    await recordManifest(tenantId, runId, documentId, {
      codebookId,
      stage: "summary",
      runIndex: 0,
      promptHash: sha256(SUMMARY_SYSTEM + JSON.stringify(SUMMARY_TOOLS)),
      inputHash: sha256(user),
      detail: { codes_summarised: out.size },
    });
  } catch {
    // Falls back to the code's own definition below.
  }
  return out;
}

async function writeCodebookAndFindings(
  tenantId: string,
  runId: string,
  documentId: string,
  codebookId: string,
  codes: CodeRow[],
  segments: StoredSegment[],
  assignments: Map<number, number[]>,
  options: { onlyReplacePending: boolean; archiveReason: ArchiveReason },
): Promise<{ id: string; finding_text: string }[]> {
  const segmentByIndex = new Map(segments.map((s) => [s.index, s]));
  // Findings and their turn counts follow what the researcher has changed by
  // hand as well as what the model assigned.
  const effective = new Map<number, number[]>(
    [...assignments].map(([k, v]) => [k, [...v]]),
  );
  try {
    const overrides = await loadOverrides(tenantId, documentId);
    const indexById = new Map(segments.map((s) => [s.id, s.index]));
    const numberByKey = new Map(codes.map((c, i) => [codeKey(c.name), i + 1]));
    for (const o of overrides) {
      const idx = indexById.get(o.segment_id);
      const n = numberByKey.get(o.code_key);
      if (idx === undefined || n === undefined) continue;
      const list = effective.get(idx) ?? [];
      if (o.action === "add" && !list.includes(n)) list.push(n);
      if (o.action === "remove")
        effective.set(
          idx,
          list.filter((x) => x !== n),
        );
      else effective.set(idx, list);
    }
  } catch {
    // overrides unavailable: findings follow the model's assignments
  }
  const turnsByCode = new Map<number, StoredSegment[]>();
  for (const [segIndex, codeNumbers] of effective) {
    const segment = segmentByIndex.get(segIndex);
    if (!segment) continue;
    for (const n of codeNumbers) {
      const list = turnsByCode.get(n) ?? [];
      list.push(segment);
      turnsByCode.set(n, list);
    }
  }
  for (const list of turnsByCode.values())
    list.sort((a, b) => a.index - b.index);

  const summaries = await summarise(
    tenantId,
    runId,
    documentId,
    codebookId,
    codes,
    turnsByCode,
  );

  return withTenant(tenantId, async (client) => {
    const segmentIds: string[] = [];
    const codeIds: string[] = [];
    for (const [segIndex, codeNumbers] of assignments) {
      const segment = segmentByIndex.get(segIndex);
      if (!segment) continue;
      for (const n of codeNumbers) {
        segmentIds.push(segment.id);
        codeIds.push(codes[n - 1].id);
      }
    }
    if (segmentIds.length > 0) {
      await client.query(
        `insert into coding_assignments (tenant_id, segment_id, code_id)
         select $1, s, c from unnest($2::uuid[], $3::uuid[]) as t(s, c)
         on conflict do nothing`,
        [tenantId, segmentIds, codeIds],
      );
    }
    // Lay the researcher's own changes back over the model's assignments.
    await applyOverrides(
      client,
      tenantId,
      documentId,
      codes.map((c) => ({ id: c.id, name: c.name })),
    );

    // Re-running the coding pass on the same transcript replaces its
    // previous themes rather than duplicating them, same as report
    // extraction. onlyReplacePending narrows that to findings already
    // rejected, and whatever is about to be deleted is snapshotted first,
    // see the matching comment in extractFindings.ts.
    await archiveAndReplaceFindings(client, {
      documentColumn: "source_document_id",
      documentId,
      onlyRejected: options.onlyReplacePending,
      archiveReason: options.archiveReason,
    });

    const rows: { id: string; finding_text: string }[] = [];
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      const turns = turnsByCode.get(i + 1) ?? [];
      if (turns.length < MIN_SEGMENTS_FOR_FINDING) continue;
      const exemplar = pickExemplar(turns);
      if (!exemplar) continue;
      // The quote comes from a participant turn the code was applied to, so
      // it should always match exactly. It is still checked, and the result
      // stored, so a regression here would show up as a failed check.
      const check = matchQuote(exemplar.quote, segments);
      const verified = check.match === "exact" && check.role !== "moderator";
      const speakers = new Set(
        turns.map((t) => t.speaker).filter((s): s is string => Boolean(s)),
      );
      const findingText =
        summaries.get(i + 1) ?? `${code.name}: ${code.definition}`;

      // status starts at 'accepted', not 'pending', so the pipeline can
      // proceed without waiting on a manual accept pass; rejection is the
      // review step now. See the matching comment in extractFindings.ts.
      const result = await client.query<{ id: string; finding_text: string }>(
        `insert into findings
           (tenant_id, run_id, origin, finding_text, finding_kind, theme, data_type, source_document_id,
            source_page, source_quote, quote_verified, quote_match, status,
            coding_code_id, supporting_segments, supporting_speakers, reproduced_runs, total_runs)
         values ($1, $2, 'coded', $3, 'own_finding', $4, 'qualitative', $5, $6, $7, $8, $9, 'accepted',
                 $10, $11, $12, $13, $14)
         returning id, finding_text`,
        [
          tenantId,
          runId,
          findingText,
          code.name,
          documentId,
          segmentByIndex.get(exemplar.segment.index)?.page ?? null,
          exemplar.quote,
          verified,
          check.match,
          code.id,
          turns.length,
          speakers.size > 0 ? speakers.size : null,
          code.reproducedRuns,
          code.totalRuns,
        ],
      );
      rows.push(result.rows[0]);
    }
    return rows;
  });
}

// --- Storage helpers ------------------------------------------------------

async function nextVersion(
  client: PoolClient,
  documentId: string,
): Promise<number> {
  const result = await client.query<{ v: number | null }>(
    "select max(version) as v from coding_codebooks where document_id = $1",
    [documentId],
  );
  return (result.rows[0]?.v ?? 0) + 1;
}

async function insertCodebook(
  tenantId: string,
  runId: string,
  documentId: string,
  source: "induced" | "edited",
  codes: {
    name: string;
    definition: string;
    inclusion: string;
    exclusion: string;
    reproducedRuns: number | null;
    totalRuns: number | null;
  }[],
): Promise<{ codebookId: string; rows: CodeRow[]; version: number }> {
  return withTenant(tenantId, async (client) => {
    const version = await nextVersion(client, documentId);
    const book = await client.query<{ id: string }>(
      `insert into coding_codebooks (tenant_id, run_id, document_id, version, source)
       values ($1, $2, $3, $4, $5) returning id`,
      [tenantId, runId, documentId, version, source],
    );
    const codebookId = book.rows[0].id;
    const rows: CodeRow[] = [];
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      const inserted = await client.query<{ id: string }>(
        `insert into coding_codes
           (tenant_id, codebook_id, position, name, definition, inclusion_criteria, exclusion_criteria,
            reproduced_runs, total_runs)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [
          tenantId,
          codebookId,
          i,
          c.name,
          c.definition,
          c.inclusion,
          c.exclusion,
          c.reproducedRuns,
          c.totalRuns,
        ],
      );
      rows.push({
        id: inserted.rows[0].id,
        position: i,
        name: c.name,
        definition: c.definition,
        inclusion: c.inclusion,
        exclusion: c.exclusion,
        reproducedRuns: c.reproducedRuns,
        totalRuns: c.totalRuns,
      });
    }
    return { codebookId, rows, version };
  });
}

async function replaceSegments(
  tenantId: string,
  runId: string,
  documentId: string,
  segments: (TranscriptSegment & { page: number | null })[],
): Promise<StoredSegment[]> {
  return withTenant(tenantId, async (client) => {
    await client.query("delete from coding_segments where document_id = $1", [
      documentId,
    ]);
    if (segments.length === 0) return [];
    const inserted = await client.query<{ id: string; segment_index: number }>(
      `insert into coding_segments (tenant_id, run_id, document_id, segment_index, speaker, role, page, text)
       select $1, $2, $3, t.i, t.sp, t.r, t.pg, t.tx
       from unnest($4::int[], $5::text[], $6::text[], $7::int[], $8::text[]) as t(i, sp, r, pg, tx)
       returning id, segment_index`,
      [
        tenantId,
        runId,
        documentId,
        segments.map((s) => s.index),
        segments.map((s) => s.speaker),
        segments.map((s) => s.role),
        segments.map((s) => s.page),
        segments.map((s) => s.text),
      ],
    );
    const idByIndex = new Map(
      inserted.rows.map((r) => [r.segment_index, r.id]),
    );
    return segments.map((s) => ({ ...s, id: idByIndex.get(s.index)! }));
  });
}

// --- How a transcript was read (migration 0046) ------------------------------

async function readSegmentationChoice(
  tenantId: string,
  documentId: string,
): Promise<{ mode: SegmentMode; moderators: string[] }> {
  try {
    return await withTenant(tenantId, async (client) => {
      const r = await client.query<{
        segmentation_mode: SegmentMode;
        moderator_labels: string[];
      }>(
        "select segmentation_mode, moderator_labels from coding_document_settings where document_id = $1",
        [documentId],
      );
      const row = r.rows[0];
      return {
        mode: row?.segmentation_mode ?? "auto",
        moderators: row?.moderator_labels ?? [],
      };
    });
  } catch {
    return { mode: "auto", moderators: [] }; // 0046 not applied yet
  }
}

// Stores what the reader did and the respondents' profile lines. Best effort
// when 0046 is missing, so coding still works before the migration is run.
async function saveSegmentationState(
  tenantId: string,
  runId: string,
  documentId: string,
  reading: SegmentationResult,
  moderators: string[],
): Promise<void> {
  try {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into coding_document_settings
           (tenant_id, run_id, document_id, segmentation_mode, segmentation_resolved, segmentation_notes, moderator_labels)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (document_id) do update set
           segmentation_mode = excluded.segmentation_mode,
           segmentation_resolved = excluded.segmentation_resolved,
           segmentation_notes = excluded.segmentation_notes,
           moderator_labels = excluded.moderator_labels,
           updated_at = now()`,
        [
          tenantId,
          runId,
          documentId,
          reading.requested,
          reading.mode,
          reading.notes,
          moderators,
        ],
      );
      await client.query(
        "delete from coding_respondent_attributes where document_id = $1",
        [documentId],
      );
      for (const profile of reading.profiles) {
        for (const [attribute, value] of Object.entries(profile.fields)) {
          await client.query(
            `insert into coding_respondent_attributes (tenant_id, run_id, document_id, speaker_key, attribute, value)
             values ($1, $2, $3, $4, $5, $6)
             on conflict (document_id, speaker_key, attribute) do update set value = excluded.value`,
            [tenantId, runId, documentId, profile.speaker, attribute, value],
          );
        }
      }
    });
  } catch (err) {
    // The transcript is still coded, but the reading is not recorded, so
    // say why instead of failing silently.
    console.error(
      "saveSegmentationState failed (is migration 0046/0047 applied?):",
      err instanceof Error ? err.message : err,
    );
  }
}

// --- Entry points ---------------------------------------------------------

export async function extractThemesFromTranscript(
  tenantId: string,
  runId: string,
  documentId: string,
  options: { onlyReplacePending?: boolean; archiveReason?: ArchiveReason } = {},
): Promise<{ id: string; finding_text: string }[]> {
  const { onlyReplacePending = false, archiveReason = "manual_reextract" } =
    options;
  const document = await withTenant(tenantId, async (client) => {
    const result = await client.query<{
      storage_path: string;
      source_filename: string;
    }>(
      "select storage_path, source_filename from documents where id = $1 and run_id = $2",
      [documentId, runId],
    );
    return result.rows[0];
  });

  if (!document) {
    throw new Error("Document not found for this run");
  }

  const extracted = await extractDocumentText(
    document.storage_path,
    document.source_filename,
    documentId,
  );

  await withTenant(tenantId, async (client) => {
    await client.query(
      "update documents set extracted_text = $1, preview_storage_path = $2 where id = $3",
      [extracted.fullText, extracted.previewStoragePath, documentId],
    );
  });

  if (extracted.fullText.trim().length < 50) {
    await recordTrace(tenantId, runId, "extract_themes_empty_text", {
      documentId,
      filename: document.source_filename,
      textLength: extracted.fullText.length,
    });
    throw new Error(
      `Almost no readable text came out of "${document.source_filename}" (${extracted.fullText.length} characters). ` +
        `The file may be image-based, empty, or in a format this reader cannot parse properly.`,
    );
  }

  const pageIndex = buildPageIndex(extracted.pages);
  const chosen = await readSegmentationChoice(tenantId, documentId);
  const reading = segmentTranscriptDetailed(extracted.fullText, chosen);
  const parsed = reading.segments.map((s) => ({
    ...s,
    page: pageForSegment(s.text, pageIndex),
  }));
  if (parsed.filter((s) => s.role !== "moderator").length === 0) {
    throw new Error(
      `No participant speech could be found in "${document.source_filename}". ` +
        `Every turn was labelled as a moderator or interviewer.`,
    );
  }

  // Step 1.
  const { text: excerpt, truncated } = buildOpenExcerpt(parsed);
  const passes = await mapWithConcurrency(
    Array.from({ length: OPEN_CODING_RUNS }, (_, i) => i + 1),
    MODEL_CONCURRENCY,
    (runIndex) =>
      runOpenCoding(
        tenantId,
        runId,
        documentId,
        parsed,
        excerpt,
        runIndex,
        truncated,
      ),
  );
  const okRuns = passes.filter((p): p is OpenRunResult => p !== null);
  if (okRuns.length === 0) {
    throw new Error(
      `None of the ${OPEN_CODING_RUNS} coding passes over "${document.source_filename}" returned usable themes. ` +
        `This is usually a temporary model problem. Try again.`,
    );
  }
  const usable = okRuns.filter((p) => p.themes.length > 0);
  if (usable.length === 0) {
    throw new Error(
      `No theme from "${document.source_filename}" could be tied to a verbatim participant quote, ` +
        `so nothing was kept. Check that the transcript labels who is speaking.`,
    );
  }

  // Step 2. Reproduction is out of the passes that returned at all, so a
  // pass whose themes were all dropped counts against every theme.
  const { codes: consolidated, manifestId } = await consolidate(
    tenantId,
    runId,
    documentId,
    usable,
  );
  if (consolidated.length === 0) {
    throw new Error(
      `The coding passes over "${document.source_filename}" could not be merged into a codebook.`,
    );
  }
  // consolidate numbered the usable passes 1..n, so reproducedRuns is out of
  // okRuns.length, which includes any pass that returned only dropped themes.
  const totalRuns = okRuns.length;

  const stored = await replaceSegments(tenantId, runId, documentId, parsed);
  await saveSegmentationState(
    tenantId,
    runId,
    documentId,
    reading,
    chosen.moderators ?? [],
  );
  const book = await insertCodebook(
    tenantId,
    runId,
    documentId,
    "induced",
    consolidated.map((c) => ({
      name: c.name,
      definition: c.definition,
      inclusion: c.inclusion,
      exclusion: c.exclusion,
      reproducedRuns: c.reproducedRuns,
      totalRuns,
    })),
  );
  const manifestIds = [...okRuns.map((r) => r.manifestId), manifestId].filter(
    (id): id is string => Boolean(id),
  );
  if (manifestIds.length > 0) {
    await withTenant(tenantId, async (client) => {
      await client.query(
        "update coding_run_manifest set codebook_id = $1 where id = any($2::uuid[])",
        [book.codebookId, manifestIds],
      );
    });
  }

  // Step 3.
  const applied = await applyCodebook(
    tenantId,
    runId,
    documentId,
    book.codebookId,
    book.rows,
    stored,
  );
  if (
    applied.totalBatches > 0 &&
    applied.failedBatches === applied.totalBatches
  ) {
    throw new Error(
      `The codebook for "${document.source_filename}" was built but could not be applied to the transcript. ` +
        `Try again.`,
    );
  }

  // Step 4.
  const rows = await writeCodebookAndFindings(
    tenantId,
    runId,
    documentId,
    book.codebookId,
    book.rows,
    stored,
    applied.assignments,
    { onlyReplacePending, archiveReason },
  );

  await recordTrace(tenantId, runId, "coding_summary", {
    documentId,
    codebook_version: book.version,
    passes_requested: OPEN_CODING_RUNS,
    passes_returned: okRuns.length,
    codes: book.rows.length,
    findings: rows.length,
    input_truncated: truncated,
    apply_batches_failed: applied.failedBatches,
    apply_batches_total: applied.totalBatches,
  });

  return rows;
}

/**
 * Applies an edited codebook to a transcript that has already been coded.
 * The edit becomes a new version (the old one stays), the codebook is
 * applied again to the stored turns, and the transcript's coded findings are
 * replaced from the result. Reproduction counts carry over only for a code
 * that kept its name; a new or renamed code has no open-coding history, so
 * it shows none.
 */
export async function reapplyCodebook(
  tenantId: string,
  runId: string,
  documentId: string,
  edits: CodebookEdit[],
): Promise<{ id: string; finding_text: string }[]> {
  const cleaned = edits
    .map((e) => ({
      id: e.id,
      name: e.name.trim(),
      definition: e.definition.trim(),
      inclusion: e.inclusion.trim(),
      exclusion: e.exclusion.trim(),
    }))
    .filter((e) => e.name && e.definition);
  if (cleaned.length === 0)
    throw new Error(
      "A codebook needs at least one code with a name and a definition.",
    );
  if (cleaned.length > MAX_CODES + 8)
    throw new Error(`A codebook can have at most ${MAX_CODES + 8} codes.`);
  const names = new Set<string>();
  for (const c of cleaned) {
    const key = c.name.toLowerCase();
    if (names.has(key))
      throw new Error(`Two codes are both called "${c.name}".`);
    names.add(key);
  }

  const { previous, segments } = await withTenant(tenantId, async (client) => {
    const prev = await client.query<{
      id: string;
      name: string;
      reproduced_runs: number | null;
      total_runs: number | null;
    }>(
      `select c.id, c.name, c.reproduced_runs, c.total_runs
       from coding_codes c
       join coding_codebooks b on b.id = c.codebook_id
       where b.document_id = $1
         and b.version = (select max(version) from coding_codebooks where document_id = $1)`,
      [documentId],
    );
    const segs = await client.query<{
      id: string;
      segment_index: number;
      speaker: string | null;
      role: "participant" | "moderator" | "unknown";
      page: number | null;
      text: string;
    }>(
      `select id, segment_index, speaker, role, page, text
       from coding_segments where document_id = $1 and run_id = $2 order by segment_index`,
      [documentId, runId],
    );
    return { previous: prev.rows, segments: segs.rows };
  });
  if (segments.length === 0) {
    throw new Error(
      "This transcript has not been coded yet, so there is nothing to apply a codebook to.",
    );
  }
  const stored: StoredSegment[] = segments.map((s) => ({
    id: s.id,
    index: s.segment_index,
    speaker: s.speaker,
    role: s.role,
    page: s.page,
    text: s.text,
  }));

  const previousById = new Map(previous.map((p) => [p.id, p]));
  const book = await insertCodebook(
    tenantId,
    runId,
    documentId,
    "edited",
    cleaned.map((c) => {
      const old = c.id ? previousById.get(c.id) : undefined;
      const keeps =
        old && old.name.trim().toLowerCase() === c.name.toLowerCase();
      return {
        name: c.name,
        definition: c.definition,
        inclusion: c.inclusion,
        exclusion: c.exclusion,
        reproducedRuns: keeps ? old.reproduced_runs : null,
        totalRuns: keeps ? old.total_runs : null,
      };
    }),
  );

  await carryResearcherFlags(tenantId, documentId, book.codebookId);
  const applied = await applyCodebook(
    tenantId,
    runId,
    documentId,
    book.codebookId,
    book.rows,
    stored,
  );
  if (
    applied.totalBatches > 0 &&
    applied.failedBatches === applied.totalBatches
  ) {
    throw new Error(
      "The edited codebook could not be applied to the transcript. Try again.",
    );
  }
  const rows = await writeCodebookAndFindings(
    tenantId,
    runId,
    documentId,
    book.codebookId,
    book.rows,
    stored,
    applied.assignments,
    { onlyReplacePending: false, archiveReason: "manual_reextract" },
  );
  await recordTrace(tenantId, runId, "coding_summary", {
    documentId,
    codebook_version: book.version,
    edited: true,
    codes: book.rows.length,
    findings: rows.length,
    apply_batches_failed: applied.failedBatches,
    apply_batches_total: applied.totalBatches,
  });
  return rows;
}

/**
 * Reads the stored transcript again with a different reading (labels,
 * headings, paragraphs, none) and a chosen set of moderator speakers, then
 * applies the current codebook to the new turns. Page numbers are not kept.
 * Turns are replaced, so calibration samples, negative cases and respondent
 * links tied to the old turns are cleared. The codebook itself is unchanged.
 */
export async function resegmentTranscript(
  tenantId: string,
  runId: string,
  documentId: string,
  mode: SegmentMode,
  moderators: string[],
): Promise<{ id: string; finding_text: string }[]> {
  const cleanedModerators = moderators.map((m) => m.trim()).filter(Boolean);
  const { text, codes } = await withTenant(tenantId, async (client) => {
    const doc = await client.query<{ extracted_text: string | null }>(
      "select extracted_text from documents where id = $1 and run_id = $2",
      [documentId, runId],
    );
    const book = await client.query<{
      id: string;
      name: string;
      definition: string;
      inclusion_criteria: string;
      exclusion_criteria: string;
    }>(
      `select c.id, c.name, c.definition, c.inclusion_criteria, c.exclusion_criteria
       from coding_codes c
       join coding_codebooks b on b.id = c.codebook_id
       where b.document_id = $1
         and b.version = (select max(version) from coding_codebooks where document_id = $1)
       order by c.position`,
      [documentId],
    );
    return { text: doc.rows[0]?.extracted_text ?? "", codes: book.rows };
  });
  if (codes.length === 0) {
    throw new Error(
      "This transcript has not been coded yet. Code it first, then change how it is read.",
    );
  }
  if (text.trim().length < 50) {
    throw new Error("The stored text for this transcript is empty.");
  }
  const reading = segmentTranscriptDetailed(text, {
    mode,
    moderators: cleanedModerators,
  });
  if (reading.segments.filter((s) => s.role !== "moderator").length === 0) {
    throw new Error(
      "With those settings every turn would be a moderator turn, so there would be nothing to code.",
    );
  }
  await replaceSegments(
    tenantId,
    runId,
    documentId,
    reading.segments.map((s) => ({ ...s, page: null })),
  );
  await saveSegmentationState(
    tenantId,
    runId,
    documentId,
    reading,
    cleanedModerators,
  );
  return reapplyCodebook(
    tenantId,
    runId,
    documentId,
    codes.map((c) => ({
      id: c.id,
      name: c.name,
      definition: c.definition,
      inclusion: c.inclusion_criteria,
      exclusion: c.exclusion_criteria,
    })),
  );
}
