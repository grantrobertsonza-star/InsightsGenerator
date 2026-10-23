import { withTenant, withTenantRead } from "./db";

// Per-million-token pricing for claude-sonnet-5, the only model this app
// calls (see CLAUDE_MODEL in anthropic.ts). Source: Anthropic's published
// API pricing as of 2026-10. If that pricing changes, update these two
// constants and every cost figure derived from logged usage recalculates
// from them; nothing else needs to change.
const INPUT_PRICE_PER_MTOK_USD = 2;
const OUTPUT_PRICE_PER_MTOK_USD = 10;

export type ClaudeUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/**
 * Records one Claude API call's token usage against a run, tagged by which
 * agent made it. Purely additive bookkeeping: it logs into the same `trace`
 * table every other pipeline event already writes to (event = 'api_usage'),
 * so it needs no schema change. A logging failure is swallowed rather than
 * thrown, the same best-effort pattern refreshVerdicts / refreshInsightQuality
 * use for their own side work, since losing one usage record is never worth
 * interrupting the pipeline step it's observing.
 */
export async function logApiUsage(
  tenantId: string,
  runId: string,
  agent: string,
  usage: ClaudeUsage
): Promise<void> {
  try {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'api_usage', $3)`,
        [
          tenantId,
          runId,
          JSON.stringify({
            agent,
            input_tokens: usage.input_tokens ?? 0,
            output_tokens: usage.output_tokens ?? 0,
            cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
            cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
          }),
        ]
      );
    });
  } catch {
    // Best-effort bookkeeping only; never let a logging failure interrupt
    // the pipeline step it's observing.
  }
}

/**
 * Estimated USD cost for uncached input and output tokens, at current Sonnet 5 pricing: an estimate
 * for the researcher's own cost awareness (and for cost estimates before a run), not a
 * reconciliation against Anthropic's invoice. For logged usage with cache writes and reads, use
 * costOfUsage.
 */
export function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * INPUT_PRICE_PER_MTOK_USD + (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MTOK_USD
  );
}

// Prompt caching prices (promptCache.ts), as multiples of the input price: a 5-minute cache write
// costs 1.25 times, a cache read a tenth (Anthropic's published pricing for Sonnet 5, 2026-10).
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

/**
 * Estimated USD cost of logged usage, cache included. `input` is the uncached input tokens (the API's
 * input_tokens, which excludes what was written to or read from the cache).
 */
export function costOfUsage(u: { input: number; output: number; cacheWrite?: number; cacheRead?: number }): number {
  const inputEquivalent = u.input + (u.cacheWrite ?? 0) * CACHE_WRITE_MULTIPLIER + (u.cacheRead ?? 0) * CACHE_READ_MULTIPLIER;
  return estimateCostUsd(inputEquivalent, u.output);
}

/**
 * Records one Claude call that belongs to no project (the Research assistant outside a project) in
 * tenant_api_usage (migration 0109), so its cost is visible on the dashboard rather than only in the
 * server log. Best effort like logApiUsage, but a failed write is also written to the server log
 * with the usage, so the figures are not lost without trace.
 */
export async function logTenantApiUsage(tenantId: string, agent: string, usage: ClaudeUsage): Promise<void> {
  const row = {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
  };
  try {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into tenant_api_usage (tenant_id, agent, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens)
         values ($1, $2, $3, $4, $5, $6)`,
        [tenantId, agent, row.input_tokens, row.output_tokens, row.cache_creation_input_tokens, row.cache_read_input_tokens],
      );
    });
  } catch (error) {
    console.info(JSON.stringify({ event: "api_usage_not_recorded", agent, tenant_id: tenantId, ...row, error: error instanceof Error ? error.message : String(error) }));
  }
}

export type TenantUsageSummary = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number;
};

/**
 * The organisation's usage outside projects over the last `days` days. A failed read is an error
 * the caller shows, never zero usage; a database without migration 0109 says so.
 */
export async function loadTenantUsageOutsideProjects(
  tenantId: string,
  days = 30,
): Promise<{ ok: true; summary: TenantUsageSummary } | { ok: false; error: string }> {
  try {
    const r = await withTenantRead(tenantId, (client) =>
      client.query<{ calls: string; input: string; output: string; write: string; read: string }>(
        `select count(*) as calls,
                coalesce(sum(input_tokens), 0) as input, coalesce(sum(output_tokens), 0) as output,
                coalesce(sum(cache_creation_input_tokens), 0) as write, coalesce(sum(cache_read_input_tokens), 0) as read
         from tenant_api_usage
         where tenant_id = $1 and created_at > now() - make_interval(days => $2)`,
        [tenantId, days],
      ),
    );
    const row = r.rows[0];
    const summary = {
      calls: Number(row.calls),
      inputTokens: Number(row.input),
      outputTokens: Number(row.output),
      cacheWriteTokens: Number(row.write),
      cacheReadTokens: Number(row.read),
    };
    return {
      ok: true,
      summary: { ...summary, costUsd: costOfUsage({ input: summary.inputTokens, output: summary.outputTokens, cacheWrite: summary.cacheWriteTokens, cacheRead: summary.cacheReadTokens }) },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: /tenant_api_usage/.test(message) && /does not exist/.test(message) ? "This needs migration 0109 applied first." : message };
  }
}
