// Prompt caching (Grant, 2026-10-22): the helpers mark one cache breakpoint at the end of the shared
// part and leave the text the model reads unchanged; logged usage is priced with cache writes at 1.25
// times and reads at a tenth of the input price (Sonnet 5).
import { describe, expect, it } from "vitest";
import { cachedSystem, cachedSystemThen, cachedUserThen } from "../promptCache";
import { costOfUsage, estimateCostUsd } from "../apiUsage";

const textOf = (blocks: { text: string }[]) => blocks.map((b) => b.text).join("");

describe("prompt cache helpers", () => {
  it("cache the shared part only, with the text unchanged", () => {
    expect(cachedSystem("Rules")).toEqual([{ type: "text", text: "Rules", cache_control: { type: "ephemeral" } }]);
    const sys = cachedSystemThen("Rules and context", "History");
    expect(textOf(sys)).toBe("Rules and context\n\nHistory");
    expect(sys.filter((b) => "cache_control" in b && b.cache_control)).toHaveLength(1);
    expect(cachedSystemThen("Rules", "")).toEqual(cachedSystem("Rules"));
    const user = cachedUserThen("Codebook:\nA", "\n\nTurns:\n1");
    expect(user.role).toBe("user");
    expect(textOf(user.content as { text: string }[])).toBe("Codebook:\nA\n\nTurns:\n1");
    expect((user.content as { cache_control?: unknown }[]).map((b) => Boolean(b.cache_control))).toEqual([true, false]);
  });
});

describe("costOfUsage", () => {
  it("prices uncached input, cache writes at 1.25 and reads at 0.1 of the input price", () => {
    // Reference: Sonnet 5 at $2 per million input and $10 per million output tokens.
    expect(costOfUsage({ input: 1_000_000, output: 0 })).toBeCloseTo(2, 10);
    expect(costOfUsage({ input: 0, output: 0, cacheWrite: 1_000_000 })).toBeCloseTo(2.5, 10);
    expect(costOfUsage({ input: 0, output: 0, cacheRead: 1_000_000 })).toBeCloseTo(0.2, 10);
    expect(costOfUsage({ input: 200, output: 300, cacheWrite: 0, cacheRead: 0 })).toBeCloseTo(estimateCostUsd(200, 300), 12);
    // A second call that reads a 10,000-token prefix instead of sending it costs a tenth for that part.
    const first = costOfUsage({ input: 500, output: 1000, cacheWrite: 10_000 });
    const second = costOfUsage({ input: 500, output: 1000, cacheRead: 10_000 });
    const uncached = estimateCostUsd(10_500, 1000);
    expect(second).toBeLessThan(uncached);
    expect(first).toBeGreaterThan(uncached);
    expect(uncached - second).toBeCloseTo((10_000 * 0.9 * 2) / 1_000_000, 10);
  });
});
