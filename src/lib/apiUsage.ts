import { withTenant } from "./db";

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
