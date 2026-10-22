import type Anthropic from "@anthropic-ai/sdk";

/**
 * Prompt caching (Grant, 2026-10-22: keep costs down if the app is sold). A call whose opening text
 * is repeated by the next calls within about five minutes marks the end of that opening with a cache
 * breakpoint; the API stores everything up to it (tools, system, then the marked block) and the next
 * calls read it at a tenth of the input price (Sonnet 5; writing it costs 1.25 times once).
 *
 * The model sees the same text either way: caching changes the price and speed, not the prompt. A
 * marked block shorter than the model's minimum (1,024 tokens for Sonnet 5) is simply not cached,
 * with no error. Usage, including cache writes and reads, is logged by logApiUsage, and costOfUsage
 * prices it.
 */

const EPHEMERAL = { type: "ephemeral" } as const;

/** A system prompt whose whole text (with the tools before it) is cached for the next calls. */
export function cachedSystem(text: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text, cache_control: EPHEMERAL }];
}

/**
 * A system prompt in two parts: `stable` is cached (with the tools before it), `changing` follows it
 * uncached. Joined with a blank line, as a single string would read.
 */
export function cachedSystemThen(stable: string, changing: string): Anthropic.TextBlockParam[] {
  return changing ? [{ type: "text", text: stable, cache_control: EPHEMERAL }, { type: "text", text: `\n\n${changing}` }] : cachedSystem(stable);
}

/** A user message whose opening part is shared by the next calls (cached) and whose rest differs. */
export function cachedUserThen(shared: string, rest: string): Anthropic.MessageParam {
  return { role: "user", content: [{ type: "text", text: shared, cache_control: EPHEMERAL }, { type: "text", text: rest }] };
}
