// The input of a forced tool call, taken only from a response that finished (Codex RR-F01, RR-F02,
// 2026-10-23). With tool_choice forcing one tool, a finished response stops with "tool_use" and
// carries that tool's block. A response cut off at max_tokens can still carry a block whose input
// is only the part written before the cut, which reads as complete (one objective out of three, half
// a methodology sentence); a refusal or any other stop carries nothing to rely on. Those are
// failures to show and retry, never results to save. A finished call that legitimately finds
// nothing is the caller's own field check (a null objective, found: false), not this one's.

export type UnfinishedReason = "max_tokens" | "refusal" | "no_tool_use" | "other_stop" | "malformed";

export class UnfinishedModelResultError extends Error {
  constructor(
    readonly reason: UnfinishedReason,
    message: string,
  ) {
    super(message);
    this.name = "UnfinishedModelResultError";
  }
}

type ToolResponse = {
  stop_reason: string | null;
  content: readonly { type: string; name?: string; input?: unknown }[];
};

/**
 * The forced tool's input as an object, or an UnfinishedModelResultError naming what went wrong.
 * `what` names the work in the researcher's words ("The reading of the brief"), for the message.
 */
export function finishedToolInput(response: ToolResponse, toolName: string, what: string): Record<string, unknown> {
  if (response.stop_reason === "max_tokens") throw new UnfinishedModelResultError("max_tokens", `${what} was cut off before it finished, so nothing from it was used. Try again.`);
  if (response.stop_reason === "refusal") throw new UnfinishedModelResultError("refusal", `${what} was declined by the model, so nothing from it was used.`);
  if (response.stop_reason !== "tool_use") throw new UnfinishedModelResultError("other_stop", `${what} did not finish (${String(response.stop_reason)}), so nothing from it was used. Try again.`);
  const block = response.content.find((b) => b.type === "tool_use" && b.name === toolName);
  if (!block) throw new UnfinishedModelResultError("no_tool_use", `${what} returned no result, so nothing from it was used. Try again.`);
  if (typeof block.input !== "object" || block.input === null || Array.isArray(block.input))
    throw new UnfinishedModelResultError("malformed", `${what} returned a result in the wrong shape, so nothing from it was used. Try again.`);
  return block.input as Record<string, unknown>;
}

/** A field that must be a string or null (absent counts as null); anything else is a malformed result. */
export function optionalTextField(input: Record<string, unknown>, field: string, what: string): string | null {
  const v = input[field];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new UnfinishedModelResultError("malformed", `${what} returned a result in the wrong shape (${field}), so nothing from it was used. Try again.`);
  const t = v.trim();
  return t.length > 0 ? t : null;
}
