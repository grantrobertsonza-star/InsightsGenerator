import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { combineStances, type Stance } from "./evidenceStance";
import { checkAtom, fromCrosstab, fromGeneric, type Atom, type CheckResult, type TableView } from "./tableClaims";
import type { CrosstabResult } from "./parseStatsFile";

/**
 * The validate path with tables only. Each stated quantitative claim is checked
 * against every table in the project, per data set, with no raw data needed.
 * The model only points at cells; tableClaims.ts reads and computes everything
 * (tier a: stated figure against the table, tier b: a re-derived gap or level
 * test). Results are kept per data set and combined with the same rule as the
 * objective evidence lane: supports and against together give mixed, silent is
 * a result.
 */

export type ClaimCheck = {
  id: string;
  finding_id: string;
  document_id: string | null;
  dataset_name: string | null;
  table_label: string | null;
  tier: "a" | "b";
  check_kind: string;
  stance: Stance;
  summary: string;
};
export type ClaimChecked = {
  finding_id: string;
  finding_text: string;
  finding_kind: string | null;
  stance: Stance;
  datasets: { document_id: string | null; name: string; stance: Stance; checks: ClaimCheck[] }[];
  /** True when no table in the project speaks to the claim. */
  nothingFound: boolean;
};

const STOP = new Set(["the", "and", "for", "are", "was", "that", "with", "than", "more", "less", "from", "have", "has", "their", "they", "this", "who", "all", "not", "but", "their", "per", "cent", "percent"]);
const tokens = (t: string) => new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));

type Loaded = { view: TableView; dataset: string; tokens: Set<string> };

async function loadViews(tenantId: string, runId: string): Promise<Loaded[]> {
  const rows = await withTenant(tenantId, async (client) => {
    const r = await client.query<{
      id: string;
      document_id: string;
      label: string | null;
      headers: string[] | null;
      rows: Record<string, unknown>[] | null;
      crosstab: (CrosstabResult & { version?: number }) | null;
      source_filename: string;
    }>(
      `select dt.id, dt.document_id, dt.label, dt.headers, dt.rows, dt.crosstab, d.source_filename
         from document_tables dt join documents d on d.id = dt.document_id
        where dt.run_id = $1 and coalesce(dt.ingestion_type, 'aggregated') <> 'raw'`,
      [runId],
    );
    return r.rows;
  });
  const out: Loaded[] = [];
  for (const r of rows) {
    const label = r.label ?? "Table";
    let view: TableView | null = null;
    if (r.crosstab && r.crosstab.version === 2) view = fromCrosstab(r.id, r.document_id, label, r.crosstab);
    else if (Array.isArray(r.headers) && r.headers.length >= 2 && Array.isArray(r.rows) && r.rows.length > 0) view = fromGeneric(r.id, r.document_id, label, r.headers, r.rows);
    if (!view || view.rows.length === 0) continue;
    out.push({ view, dataset: r.source_filename, tokens: tokens(`${label} ${view.cols.join(" ")} ${view.rows.slice(0, 300).join(" ")}`) });
  }
  return out;
}

/** Top tables for a claim: up to 2 per data set, 6 overall, by shared words. */
function candidates(claim: string, all: Loaded[]): Loaded[] {
  const ct = tokens(claim);
  const scored = all
    .map((l) => ({ l, s: [...ct].filter((w) => l.tokens.has(w)).length }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  const perDoc = new Map<string, number>();
  const picked: Loaded[] = [];
  for (const { l } of scored) {
    const n = perDoc.get(l.view.datasetId) ?? 0;
    if (n >= 2) continue;
    perDoc.set(l.view.datasetId, n + 1);
    picked.push(l);
    if (picked.length >= 6) break;
  }
  return picked;
}

function render(i: number, l: Loaded): string {
  const v = l.view;
  const lines = [`[T${i}] data set "${l.dataset}", table "${v.label}"`, `Columns: ${v.cols.join(" | ")}`];
  for (const row of v.rows.slice(0, 30)) {
    const vals = v.cols.map((c) => {
      const cell = v.cell(row, c);
      return cell?.value === null || cell === null ? "-" : String(Math.round(cell.value * 10) / 10);
    });
    lines.push(`  ${row}: ${vals.join(" | ")}`);
  }
  return lines.join("\n").slice(0, 5000);
}

const TOOL: Anthropic.Tool = {
  name: "record_atoms",
  description: "Point at the table cells that bear on the claim. Do not compute anything.",
  input_schema: {
    type: "object",
    properties: {
      atoms: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["level", "comparison"] },
            table: { type: "integer", description: "The number in [T#]." },
            row: { type: "string", description: "Row label exactly as shown." },
            col: { type: "string", description: "level only: column label exactly as shown." },
            col_a: { type: "string", description: "comparison only." },
            col_b: { type: "string", description: "comparison only." },
            direction: { type: "string", enum: ["a_higher", "b_higher", "above", "below"], description: "comparison: which column the claim says is higher. level with a threshold: above or below." },
            stated_text: { type: "string", description: "level only: the figure as the claim writes it, e.g. '43%'. Leave empty if the claim gives none." },
            threshold: { type: "number", description: "level only: a threshold the claim implies, e.g. 50 for 'a majority'." },
            claims_significant: { type: "boolean", description: "comparison only: true if the claim says the difference is significant." },
          },
          required: ["kind", "table", "row"],
        },
      },
    },
    required: ["atoms"],
  },
};

async function locate(tenantId: string, runId: string, claim: string, picks: Loaded[]): Promise<(Atom & { table: number })[]> {
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1200,
    system:
      "You point at the cells of survey tables that a report claim refers to, so a program can check them. You never compute or copy a number except the figure the claim itself states.\n" +
      "- level: one cell (row and column), with the claim's own figure in stated_text, or a threshold if the claim implies one (for example 'a majority' means 50, above).\n" +
      "- comparison: the same row in two columns, with the direction the claim states.\n" +
      "- Use labels exactly as shown. Only use tables that really contain what the claim talks about. If none do, return no atoms.\n" +
      "- Causal or opinion parts of a claim cannot be checked; ignore them.\n\n" +
      picks.map((p, i) => render(i + 1, p)).join("\n\n"),
    tools: [TOOL],
    tool_choice: { type: "tool", name: "record_atoms" },
    messages: [{ role: "user", content: `Claim: ${claim}` }],
  });
  await logApiUsage(tenantId, runId, "claim_table_check", response.usage);
  const tu = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const raw = tu && Array.isArray((tu.input as { atoms?: unknown }).atoms) ? ((tu.input as { atoms: unknown[] }).atoms as Record<string, unknown>[]) : [];
  const s = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
  const out: (Atom & { table: number })[] = [];
  for (const a of raw.slice(0, 3)) {
    const table = typeof a.table === "number" ? a.table : 0;
    const row = s(a.row);
    if (!row || table < 1 || table > picks.length) continue;
    if (a.kind === "level") {
      const col = s(a.col);
      if (!col) continue;
      const thr = typeof a.threshold === "number" ? a.threshold : null;
      out.push({ kind: "level", table, row, col, statedText: s(a.stated_text), threshold: thr, direction: thr !== null && (a.direction === "above" || a.direction === "below") ? a.direction : null });
    } else if (a.kind === "comparison") {
      const colA = s(a.col_a);
      const colB = s(a.col_b);
      if (!colA || !colB || (a.direction !== "a_higher" && a.direction !== "b_higher")) continue;
      out.push({ kind: "comparison", table, row, colA, colB, direction: a.direction, claimsSignificant: a.claims_significant === true });
    }
  }
  return out;
}

async function store(
  tenantId: string,
  runId: string,
  findingId: string,
  rows: { loaded: Loaded | null; result: CheckResult }[],
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query("delete from claim_table_checks where finding_id = $1", [findingId]);
    for (const { loaded, result } of rows) {
      await client.query(
        `insert into claim_table_checks (tenant_id, run_id, finding_id, document_id, dataset_name, table_id, table_label, tier, check_kind, stance, summary, detail)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          tenantId,
          runId,
          findingId,
          loaded?.view.datasetId ?? null,
          loaded?.dataset ?? null,
          loaded?.view.id ?? null,
          loaded?.view.label ?? null,
          result.tier,
          result.check,
          result.stance,
          result.summary.slice(0, 1200),
          JSON.stringify(result.detail),
        ],
      );
    }
  });
}

/** Checks up to `limit` claims that have no check yet. Returns how many remain, so the caller can keep going. */
export async function checkClaimsPending(tenantId: string, runId: string, limit = 3): Promise<{ done: number; remaining: number }> {
  const pendingSql = `select f.id, f.finding_text from findings f
      where f.run_id = $1 and f.origin = 'stated' and f.status = 'accepted'
        and f.finding_kind in ('stated_insight', 'fact', 'own_finding')
        and (f.data_type is null or f.data_type = 'quantitative')
        and not exists (select 1 from claim_table_checks c where c.finding_id = f.id)`;
  const claims = await withTenant(tenantId, async (client) => {
    const r = await client.query<{ id: string; finding_text: string }>(`${pendingSql} order by f.created_at limit $2`, [runId, limit]);
    return r.rows;
  });
  if (claims.length > 0) {
    const all = await loadViews(tenantId, runId);
    for (const claim of claims) {
      const picks = candidates(claim.finding_text, all);
      const rows: { loaded: Loaded | null; result: CheckResult }[] = [];
      if (picks.length > 0) {
        try {
          for (const atom of await locate(tenantId, runId, claim.finding_text, picks)) {
            const loaded = picks[atom.table - 1];
            for (const result of checkAtom(loaded.view, atom)) rows.push({ loaded, result });
          }
        } catch {
          continue; // leave it unchecked; the next run tries again
        }
      }
      if (rows.length === 0) {
        rows.push({ loaded: null, result: { tier: "a", check: "locate", stance: "silent", summary: "No table in this project speaks to this claim.", detail: {} } });
      }
      await store(tenantId, runId, claim.id, rows);
    }
  }
  const remaining = await withTenant(tenantId, async (client) => {
    const r = await client.query<{ n: string }>(`select count(*) as n from (${pendingSql}) q`, [runId]);
    return Number(r.rows[0].n);
  });
  return { done: claims.length, remaining };
}

export async function resetClaimChecks(tenantId: string, runId: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query("delete from claim_table_checks where run_id = $1", [runId]);
  });
}

export async function listClaimChecks(tenantId: string, runId: string): Promise<ClaimChecked[]> {
  const rows = await withTenant(tenantId, async (client) => {
    const r = await client.query<ClaimCheck & { finding_text: string; finding_kind: string | null }>(
      `select c.id, c.finding_id, c.document_id, c.dataset_name, c.table_label, c.tier, c.check_kind, c.stance, c.summary,
              f.finding_text, f.finding_kind
         from claim_table_checks c join findings f on f.id = c.finding_id
        where c.run_id = $1 order by f.created_at, c.created_at`,
      [runId],
    );
    return r.rows;
  });
  const byClaim = new Map<string, ClaimChecked>();
  for (const r of rows) {
    let g = byClaim.get(r.finding_id);
    if (!g) {
      g = { finding_id: r.finding_id, finding_text: r.finding_text, finding_kind: r.finding_kind, stance: "silent", datasets: [], nothingFound: false };
      byClaim.set(r.finding_id, g);
    }
    if (r.document_id === null && r.dataset_name === null) {
      g.nothingFound = true;
      continue;
    }
    const key = r.document_id ?? r.dataset_name ?? "";
    let d = g.datasets.find((x) => (x.document_id ?? x.name) === key);
    if (!d) {
      d = { document_id: r.document_id, name: r.dataset_name ?? "Unknown data set", stance: "silent", checks: [] };
      g.datasets.push(d);
    }
    d.checks.push(r);
  }
  const out = [...byClaim.values()];
  for (const g of out) {
    // A claim that was found in a table but only "located" without anything to check counts as silent there.
    for (const d of g.datasets) d.stance = combineStances(d.checks.map((c) => c.stance));
    g.stance = combineStances(g.datasets.map((d) => d.stance));
  }
  return out;
}


/**
 * What the tables said about each of these claims, as short lines for the verification step to read.
 * Silent results are left out: "no table speaks to it" is not evidence either way. Empty when the
 * check table is not migrated or nothing has been checked yet.
 */
export async function checkEvidenceFor(
  tenantId: string,
  runId: string,
  findingIds: string[],
): Promise<Map<string, { stance: Stance; lines: string[] }>> {
  const out = new Map<string, { stance: Stance; lines: string[] }>();
  if (findingIds.length === 0) return out;
  try {
    const rows = await withTenant(tenantId, async (client) => {
      const r = await client.query<{ finding_id: string; dataset_name: string | null; stance: Stance; summary: string }>(
        `select finding_id, dataset_name, stance, summary from claim_table_checks
          where run_id = $1 and finding_id = any($2::uuid[]) and stance <> 'silent'
          order by finding_id, dataset_name`,
        [runId, findingIds],
      );
      return r.rows;
    });
    const by = new Map<string, typeof rows>();
    for (const r of rows) by.set(r.finding_id, [...(by.get(r.finding_id) ?? []), r]);
    for (const [id, rs] of by) {
      out.set(id, {
        stance: combineStances(rs.map((x) => x.stance)),
        lines: rs.slice(0, 4).map((x) => `${x.dataset_name ? `[${x.dataset_name}] ` : ""}${x.stance}: ${x.summary}`.slice(0, 260)),
      });
    }
  } catch {
    // table not migrated yet: no evidence lines
  }
  return out;
}
