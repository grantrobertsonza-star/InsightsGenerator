import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { buildCrosstab, loadCrosstab, loadVariableDictionary } from "./crosstabs";
import { planCrosstabFromText } from "./crosstabAsk";
import { defaultWeight } from "./starterTables";
import { capWords, parseNumberedItems } from "./text";
import { isCaseTableFileName, isStatsFileName } from "./statsFileName";
import {
  combineStances,
  parseExpectation,
  readExpectation,
  type EvidenceEstimate,
  type Expectation,
  type Stance,
} from "./evidenceStance";
import type { CrosstabResult } from "./parseStatsFile";

/**
 * The objective evidence lane. Each research objective (and confirmed
 * decision) is broken into a few evidence questions: what is measured, for
 * whom, and what result would support or undermine it. Each question is
 * answered with a table from the same engine as every other crosstab, and the
 * result is stored as evidence with a stance: supports, against, mixed,
 * inconclusive, or silent.
 *
 * It needs no column and no significance. An estimate with its interval, a
 * comparison of two groups, or a level against a stated threshold all count.
 * Where the expectation is measurable the stance is computed in code
 * (evidenceStance.ts) and labelled "computed". Otherwise the model reads the
 * table and the stance is labelled "judged".
 *
 * The questions, and the margin for "no meaningful difference", are written
 * before any table is seen, so the expectation cannot be fitted to the result.
 * They are stored visibly and can be edited or excluded; the lane runs on its
 * own by default.
 *
 * Deliberately separate from finding extraction and from discovery: those stay
 * objective-blind so patterns that fit no objective can still surface.
 */

export type EvidenceQuestion = {
  id: string;
  item_kind: "objective" | "decision";
  item_order: number;
  item_text: string;
  question: string;
  request_text: string;
  supports_if: string;
  against_if: string;
  expectation: Expectation | null;
  source: "auto" | "edited" | "manual";
  excluded: boolean;
  /** Derived from `results`: the stance across data sets, and how it was decided. */
  stance: Stance | null;
  basis: "computed" | "judged" | null;
  error: string | null;
  /** One answer per data file. */
  results: DatasetResult[];
};

export type DatasetResult = {
  document_id: string;
  dataset_name: string;
  table_id: string | null;
  stance: Stance | null;
  basis: "computed" | "judged" | null;
  estimate: EvidenceEstimate | null;
  summary: string | null;
  error: string | null;
  evaluated_at: string | null;
};

export type ItemEvidence = {
  item_kind: "objective" | "decision";
  item_order: number;
  item_text: string;
  stance: Stance;
  questions: EvidenceQuestion[];
};

type RawItem = { kind: "objective" | "decision"; order: number; text: string };

const MAX_QUESTIONS_PER_ITEM = 3;
const COLUMNS = `id, item_kind, item_order, item_text, question, request_text, supports_if, against_if, expectation, source, excluded`;
const RESULT_COLUMNS = `evidence_id, document_id, dataset_name, table_id, stance, basis, estimate, summary, error, evaluated_at`;

/** The question's own stance is the combination of its per-data-set answers. Silent counts only when nothing else spoke. */
function shape(r: Record<string, unknown>, results: DatasetResult[]): EvidenceQuestion {
  const answered = results.filter((x) => x.stance);
  const errors = results.filter((x) => x.error).map((x) => `${x.dataset_name}: ${x.error}`);
  return {
    ...(r as unknown as EvidenceQuestion),
    expectation: parseExpectation(r.expectation),
    results,
    stance: answered.length ? combineStances(answered.map((x) => x.stance as Stance)) : null,
    basis: answered.length ? (answered.every((x) => x.basis === "computed") ? "computed" : "judged") : null,
    error: errors.length ? errors.join(" ").slice(0, 600) : null,
  };
}

export type EvidenceDataset = { id: string; name: string };

/** The data files in the project that questions are asked of: SPSS, Stata or SAS files, and raw case tables. */
export async function evidenceDatasets(tenantId: string, runId: string): Promise<EvidenceDataset[]> {
  const rows = await withTenant(tenantId, async (client) => {
    const r = await client.query<{ id: string; source_filename: string; ingestion_type: string | null }>(
      "select id, source_filename, ingestion_type from documents where run_id = $1 and kind = 'table' order by source_filename",
      [runId],
    );
    return r.rows;
  });
  return rows
    .filter((d) => isStatsFileName(d.source_filename) || (d.ingestion_type === "raw" && isCaseTableFileName(d.source_filename)))
    .map((d) => ({ id: d.id, name: d.source_filename }));
}

/** Stated objectives and confirmed decisions. Ones the app inferred from this project's own data are left out: reading the data against them would be circular. */
async function loadItems(tenantId: string, runId: string): Promise<{ items: RawItem[]; skippedInferred: number }> {
  const d = await withTenant(tenantId, async (client) => {
    const run = await client.query<{ research_objective: string | null; decision_statement: string | null }>(
      "select research_objective, decision_statement from runs where id = $1",
      [runId],
    );
    const oc = await client.query<{ candidate_text: string; source: string }>(
      "select candidate_text, source from objective_candidates where run_id = $1 and status = 'accepted' order by created_at",
      [runId],
    );
    const dc = await client.query<{ candidate_text: string; source: string }>(
      "select candidate_text, source from decision_candidates where run_id = $1 and status = 'accepted' order by created_at",
      [runId],
    );
    return { run: run.rows[0], oc: oc.rows, dc: dc.rows };
  });
  if (!d.run) throw new Error("Project not found");
  let skippedInferred = 0;
  const pick = (kind: "objective" | "decision", cands: { candidate_text: string; source: string }[], text: string | null): RawItem[] => {
    if (cands.length > 0) {
      const out: RawItem[] = [];
      cands.forEach((c, order) => {
        if (c.source === "ai_suggested") skippedInferred++;
        else out.push({ kind, order, text: c.candidate_text });
      });
      return out;
    }
    return parseNumberedItems(text).map((t, order): RawItem => ({ kind, order, text: t }));
  };
  return {
    items: [...pick("objective", d.oc, d.run.research_objective), ...pick("decision", d.dc, d.run.decision_statement)],
    skippedInferred,
  };
}

export async function listObjectiveEvidence(tenantId: string, runId: string): Promise<EvidenceQuestion[]> {
  return withTenant(tenantId, async (client) => {
    const r = await client.query(
      `select ${COLUMNS} from objective_evidence where run_id = $1 order by item_kind desc, item_order, created_at`,
      [runId],
    );
    const res = await client.query(
      `select ${RESULT_COLUMNS} from objective_evidence_results where run_id = $1 order by dataset_name`,
      [runId],
    );
    const byQuestion = new Map<string, DatasetResult[]>();
    for (const x of res.rows as (DatasetResult & { evidence_id: string })[]) {
      byQuestion.set(x.evidence_id, [...(byQuestion.get(x.evidence_id) ?? []), x]);
    }
    return r.rows.map((row) => shape(row, byQuestion.get(row.id as string) ?? []));
  });
}

/** Per objective or decision: the stance across its evidence questions, ignoring excluded and unanswered ones. */
export function rollUp(questions: EvidenceQuestion[]): ItemEvidence[] {
  const groups = new Map<string, EvidenceQuestion[]>();
  for (const q of questions) {
    const key = `${q.item_kind}:${q.item_order}`;
    groups.set(key, [...(groups.get(key) ?? []), q]);
  }
  return [...groups.values()].map((qs) => {
    const live = qs.filter((q) => !q.excluded && q.stance);
    return {
      item_kind: qs[0].item_kind,
      item_order: qs[0].item_order,
      item_text: qs[0].item_text,
      stance: combineStances(live.map((q) => q.stance as Stance)),
      questions: qs,
    };
  });
}

// ---------------------------------------------------------------------------
// 1. Break each objective into evidence questions.

const DECOMPOSE_TOOL: Anthropic.Tool = {
  name: "submit_questions",
  description: "Submit the evidence questions for this objective.",
  input_schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        maxItems: MAX_QUESTIONS_PER_ITEM,
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "The evidence question in plain words, e.g. 'Do women use mobile banking more than men?'" },
            request: {
              type: "string",
              description:
                "A plain-English table request using words likely to appear in the survey, e.g. 'mobile banking use by gender'. One measure, at most one split.",
            },
            supports_if: { type: "string", description: "What result would support the objective." },
            against_if: { type: "string", description: "What result would undermine it." },
            expectation: {
              type: "object",
              description:
                "Fill only when the result can be judged from numbers. kind 'none' otherwise. Never invent a threshold: use 'level' only when the objective or the brief states one.",
              properties: {
                kind: { type: "string", enum: ["none", "level", "comparison"] },
                answer: { type: "string", description: "The answer label to read, e.g. 'Yes'. Empty for an average." },
                direction: { type: "string", enum: ["above", "below", "higher", "lower"] },
                threshold: { type: "number", description: "level only: percent for a share, or the unit of the average." },
                groupA: { type: "string", description: "comparison only: the group expected to differ." },
                groupB: { type: "string", description: "comparison only: the group compared with." },
                margin: { type: "number", description: "comparison only, optional: a gap (in points) small enough to count as no meaningful difference." },
              },
              required: ["kind"],
            },
          },
          required: ["question", "request", "supports_if", "against_if", "expectation"],
        },
      },
    },
    required: ["questions"],
  },
};

function varSummary(names: { name: string; label: string }[]): string {
  return names
    .slice(0, 160)
    .map((v) => `${v.name}: ${v.label}`.slice(0, 90))
    .join("\n");
}

type Drafted = { question: string; request: string; supports_if: string; against_if: string; expectation: Expectation | null };

async function decompose(tenantId: string, runId: string, item: RawItem, vars: string): Promise<Drafted[]> {
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    system:
      "You turn a research objective or decision into a few evidence questions that a survey data file can answer.\n" +
      `- Write at most ${MAX_QUESTIONS_PER_ITEM} questions. Fewer is better than padding. Each must be answerable from the variables listed.\n` +
      "- Evidence does not need a significance test. A level, a share, an average, or a comparison of two groups all count.\n" +
      "- For each, say in words what result would support the objective and what would undermine it. Decide this now, before any data is seen.\n" +
      "- Give a machine-readable expectation only when it can be judged from numbers. Never invent a threshold or a benchmark; if the objective does not state one, use a comparison with a direction, or kind 'none'.\n" +
      "- Use only variables that appear in the list. If the files cannot speak to the objective, return no questions.\n" +
      "- The same question will be put to every data file in the project. A file that lacks the variable will simply answer that it is silent, so write each question about the topic and not about one file.\n\n" +
      `Variables across the project's data files:\n${vars}`,
    tools: [DECOMPOSE_TOOL],
    tool_choice: { type: "tool", name: "submit_questions" },
    messages: [{ role: "user", content: `${item.kind === "objective" ? "Research objective" : "Decision"}: ${item.text}` }],
  });
  await logApiUsage(tenantId, runId, "objective_evidence", response.usage);
  const tu = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const raw = tu && Array.isArray((tu.input as { questions?: unknown }).questions) ? ((tu.input as { questions: unknown[] }).questions as Record<string, unknown>[]) : [];
  const out: Drafted[] = [];
  for (const q of raw.slice(0, MAX_QUESTIONS_PER_ITEM)) {
    const question = typeof q.question === "string" ? q.question.trim() : "";
    const request = typeof q.request === "string" ? q.request.trim() : "";
    if (!question || request.length < 5) continue;
    const e = (q.expectation ?? {}) as Record<string, unknown>;
    const expectation = e.kind === "none" ? null : parseExpectation({ ...e, answer: typeof e.answer === "string" && e.answer.trim() ? e.answer : null });
    out.push({
      question: capWords(question, 30),
      request: request.slice(0, 300),
      supports_if: capWords(String(q.supports_if ?? ""), 30),
      against_if: capWords(String(q.against_if ?? ""), 30),
      expectation,
    });
  }
  return out;
}

/**
 * Writes the evidence questions for every stated objective and decision.
 * Replaces earlier automatic questions; ones the researcher edited or added are kept.
 */
export async function generateEvidenceQuestions(
  tenantId: string,
  runId: string,
): Promise<{ created: number; items: number; skippedInferred: number; datasets: number }> {
  const { items, skippedInferred } = await loadItems(tenantId, runId);
  if (items.length === 0) throw new Error("This project has no stated objective or confirmed decision to gather evidence for.");
  const datasets = await evidenceDatasets(tenantId, runId);
  if (datasets.length === 0) throw new Error("This project has no survey data file (SPSS, Stata, SAS or a raw case table) to gather evidence from.");
  // Questions are written once, from the variables of every file, then asked of each file separately.
  const perFile = Math.max(40, Math.floor(160 / datasets.length));
  const seen = new Set<string>();
  const pooled: { name: string; label: string }[] = [];
  for (const ds of datasets) {
    const dict = await loadVariableDictionary(tenantId, runId, ds.id);
    for (const v of dict.variables.filter((x) => !x.weightLike && !x.text).slice(0, perFile)) {
      const key = (v.label || v.name).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      pooled.push(v);
    }
  }
  const vars = varSummary(pooled);
  const kept = await withTenant(tenantId, async (client) => {
    const r = await client.query<{ item_kind: string; item_order: number }>(
      "select distinct item_kind, item_order from objective_evidence where run_id = $1 and source <> 'auto'",
      [runId],
    );
    return new Set(r.rows.map((x) => `${x.item_kind}:${x.item_order}`));
  });
  let created = 0;
  const drafted: { item: RawItem; qs: Drafted[] }[] = [];
  for (const item of items) {
    if (kept.has(`${item.kind}:${item.order}`)) continue; // the researcher has taken over this one
    drafted.push({ item, qs: await decompose(tenantId, runId, item, vars) });
  }
  await withTenant(tenantId, async (client) => {
    await client.query("delete from objective_evidence where run_id = $1 and source = 'auto'", [runId]);
    for (const { item, qs } of drafted) {
      for (const q of qs) {
        await client.query(
          `insert into objective_evidence (tenant_id, run_id, document_id, item_kind, item_order, item_text, question, request_text, supports_if, against_if, expectation)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [tenantId, runId, null, item.kind, item.order, capWords(item.text, 40), q.question, q.request, q.supports_if, q.against_if, q.expectation ? JSON.stringify(q.expectation) : null],
        );
        created++;
      }
    }
  });
  return { created, items: items.length, skippedInferred, datasets: datasets.length };
}

// ---------------------------------------------------------------------------
// 2. Answer a question with a table and read it.

function tableText(result: CrosstabResult): string {
  const cols = result.columns.map((c) => c.name);
  const lines: string[] = [`Columns: ${cols.join(" | ")} | Total`];
  for (const q of result.questions) {
    lines.push(`Question: ${q.label}`);
    for (const r of q.rows.slice(0, 40)) {
      const cells = [...r.pct, r.total.pct].map((x) => (x === null || x === undefined ? "-" : String(Math.round(x * 10) / 10)));
      const n = r.isBase ? ` (base: ${[...r.count, r.total.count].join(" | ")})` : "";
      lines.push(`  ${r.label}: ${cells.join(" | ")}${n}`);
    }
  }
  return lines.join("\n").slice(0, 9000);
}

async function judge(
  tenantId: string,
  runId: string,
  q: EvidenceQuestion,
  result: CrosstabResult,
): Promise<{ stance: Stance; summary: string }> {
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 700,
    system:
      "You read a survey table as evidence for or against a research objective. Be conservative.\n" +
      "- Percentages are column percentages unless stated. No significance flags are needed: read the level or the gap, and weigh the bases.\n" +
      "- supports / against: the numbers clearly point that way, judged against what was written down in advance. inconclusive: the numbers are there but differences are small or bases thin. silent: the table does not speak to the question. mixed: parts point both ways.\n" +
      "- Do not claim a difference is statistically significant. Say what the numbers show in one or two plain sentences, with the key figures.",
    tools: [
      {
        name: "record_stance",
        description: "Record how the table bears on the objective.",
        input_schema: {
          type: "object",
          properties: {
            stance: { type: "string", enum: ["supports", "against", "mixed", "inconclusive", "silent"] },
            summary: { type: "string" },
          },
          required: ["stance", "summary"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "record_stance" },
    messages: [
      {
        role: "user",
        content:
          `Objective: ${q.item_text}\nEvidence question: ${q.question}\nSupports if: ${q.supports_if}\nUndermines if: ${q.against_if}\n\nTable:\n${tableText(result)}`,
      },
    ],
  });
  await logApiUsage(tenantId, runId, "objective_evidence", response.usage);
  const tu = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const input = (tu?.input ?? {}) as { stance?: string; summary?: string };
  const ok: Stance[] = ["supports", "against", "mixed", "inconclusive", "silent"];
  const stance = ok.find((s) => s === input.stance) ?? "inconclusive";
  return { stance, summary: capWords(String(input.summary ?? "The table was read but no summary came back."), 60) };
}

async function storeResult(
  tenantId: string,
  runId: string,
  evidenceId: string,
  ds: EvidenceDataset,
  r: { table_id?: string | null; stance?: Stance | null; basis?: "computed" | "judged" | null; estimate?: EvidenceEstimate | null; summary?: string | null; error?: string | null },
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `insert into objective_evidence_results (tenant_id, run_id, evidence_id, document_id, dataset_name, table_id, stance, basis, estimate, summary, error, evaluated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       on conflict (evidence_id, document_id) do update
         set table_id = excluded.table_id, stance = excluded.stance, basis = excluded.basis, estimate = excluded.estimate,
             summary = excluded.summary, error = excluded.error, evaluated_at = now()`,
      [
        tenantId,
        runId,
        evidenceId,
        ds.id,
        ds.name,
        r.table_id ?? null,
        r.stance ?? null,
        r.basis ?? null,
        r.estimate ? JSON.stringify(r.estimate) : null,
        r.summary ? r.summary.slice(0, 1200) : null,
        r.error ? r.error.slice(0, 600) : null,
      ],
    );
  });
}

/** Builds the table for one question in one data file and reads it. Failures are stored on the row, never thrown. A file with no matching variable is silent, not an error. */
export async function evaluateEvidenceQuestion(tenantId: string, runId: string, ds: EvidenceDataset, id: string): Promise<void> {
  const q = await withTenant(tenantId, async (client) => {
    const r = await client.query(`select ${COLUMNS} from objective_evidence where id = $1 and run_id = $2`, [id, runId]);
    return r.rows[0] ? shape(r.rows[0], []) : null;
  });
  if (!q) return;
  try {
    const plan = await planCrosstabFromText(tenantId, runId, ds.id, q.request_text);
    if (plan.rows.length === 0) {
      await storeResult(tenantId, runId, id, ds, {
        stance: "silent",
        basis: "computed",
        summary: `${ds.name} has no variable that matches "${q.request_text}", so it cannot speak to this question.`,
      });
      return;
    }
    const dict = await loadVariableDictionary(tenantId, runId, ds.id);
    const built = await buildCrosstab(
      tenantId,
      runId,
      ds.id,
      {
        columnVars: plan.columns.map((c) => c.name),
        rowItems: plan.rows,
        weightVar: defaultWeight(dict),
        filters: plan.filters,
        source: "ask",
      },
      { status: "evidence" },
    );
    const { result } = await loadCrosstab(tenantId, runId, built.tableId);
    if (!result) throw new Error("The table could not be read back.");

    const computed = q.expectation ? readExpectation(result, q.expectation) : null;
    let stance: Stance;
    let basis: "computed" | "judged";
    let summary: string;
    let estimate: EvidenceEstimate | null = null;
    if (computed) {
      ({ stance, summary, estimate } = { stance: computed.stance, summary: computed.summary, estimate: computed.estimate });
      basis = "computed";
    } else {
      const j = await judge(tenantId, runId, q, result);
      stance = j.stance;
      summary = j.summary;
      basis = "judged";
    }
    const note = plan.unclear.length ? ` Table set-up notes: ${plan.unclear.join(" ")}` : "";
    await storeResult(tenantId, runId, id, ds, { table_id: built.tableId, stance, basis, estimate, summary: summary + note });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await storeResult(tenantId, runId, id, ds, { error: message });
  }
}

/** Question and data-file pairs with no answer yet (a stored error counts as answered until retried). */
async function pendingPairs(tenantId: string, runId: string): Promise<{ id: string; ds: EvidenceDataset }[]> {
  const datasets = await evidenceDatasets(tenantId, runId);
  return withTenant(tenantId, async (client) => {
    const qs = await client.query<{ id: string }>(
      "select id from objective_evidence where run_id = $1 and excluded = false order by item_kind desc, item_order, created_at",
      [runId],
    );
    const done = await client.query<{ evidence_id: string; document_id: string }>(
      "select evidence_id, document_id from objective_evidence_results where run_id = $1",
      [runId],
    );
    const have = new Set(done.rows.map((x) => `${x.evidence_id}:${x.document_id}`));
    const out: { id: string; ds: EvidenceDataset }[] = [];
    for (const q of qs.rows) for (const ds of datasets) if (!have.has(`${q.id}:${ds.id}`)) out.push({ id: q.id, ds });
    return out;
  });
}

/** Answers up to `limit` question and file pairs. Returns how many remain, so the caller can keep going. */
export async function evaluatePending(tenantId: string, runId: string, limit = 2): Promise<{ done: number; remaining: number }> {
  const todo = await pendingPairs(tenantId, runId);
  const batch = todo.slice(0, limit);
  for (const p of batch) await evaluateEvidenceQuestion(tenantId, runId, p.ds, p.id);
  return { done: batch.length, remaining: todo.length - batch.length };
}

// ---------------------------------------------------------------------------
// 3. Researcher controls.

export async function editEvidenceQuestion(
  tenantId: string,
  runId: string,
  id: string,
  patch: { question?: string; request_text?: string; supports_if?: string; against_if?: string; excluded?: boolean },
): Promise<void> {
  const changedWording = patch.question !== undefined || patch.request_text !== undefined || patch.supports_if !== undefined || patch.against_if !== undefined;
  await withTenant(tenantId, async (client) => {
    await client.query(
      `update objective_evidence set
         question = coalesce($3, question),
         request_text = coalesce($4, request_text),
         supports_if = coalesce($5, supports_if),
         against_if = coalesce($6, against_if),
         excluded = coalesce($7, excluded),
         source = case when $8 then 'edited' else source end,
         -- an edit drops the numeric expectation: the old threshold no longer matches the new wording
         expectation = case when $8 then null else expectation end
       where id = $1 and run_id = $2`,
      [
        id,
        runId,
        patch.question?.trim().slice(0, 400) ?? null,
        patch.request_text?.trim().slice(0, 300) ?? null,
        patch.supports_if?.trim().slice(0, 400) ?? null,
        patch.against_if?.trim().slice(0, 400) ?? null,
        patch.excluded ?? null,
        changedWording,
      ],
    );
    // an edit clears the old answers; they are read again on the next run
    if (changedWording) await client.query("delete from objective_evidence_results where evidence_id = $1 and run_id = $2", [id, runId]);
  });
}

/** Clears the answers of one question, or every failed answer, so they are read again. */
export async function retryEvidence(tenantId: string, runId: string, id?: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `delete from objective_evidence_results
        where run_id = $1 and (($2::uuid is null and error is not null) or evidence_id = $2::uuid)`,
      [runId, id ?? null],
    );
  });
}

/**
 * A short block for the objective check: what the data itself says about each
 * objective, so a conclusion can cite direct evidence and not only insights.
 * Empty when the lane has not run or its table is not migrated.
 */
export async function evidenceDigest(tenantId: string, runId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const qs = await listObjectiveEvidence(tenantId, runId);
    for (const g of rollUp(qs)) {
      const live = g.questions.filter((q) => !q.excluded && q.stance);
      if (live.length === 0) continue;
      const line = (q: EvidenceQuestion) => {
        const parts = q.results
          .filter((x) => x.stance)
          .map((x) => `${q.results.length > 1 ? `[${x.dataset_name}] ` : ""}${x.stance}${x.basis === "judged" ? " (judged)" : ""}: ${x.summary ?? ""}`);
        return `${q.question} -> ${q.stance}: ${parts.join(" ")}`;
      };
      out.set(`${g.item_kind}:${g.item_order}`, `Direct data evidence (${g.stance}): ` + live.map(line).join(" ").slice(0, 900));
    }
  } catch {
    // table not migrated yet: no digest
  }
  return out;
}
