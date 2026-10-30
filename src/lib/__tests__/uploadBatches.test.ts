// The Add files dialog's batches (Grant, 28 October 2026: files chosen together over 100 MB failed the page with
// "Unexpected end of form"). Pure.
import { describe, expect, it } from "vitest";
import { planUploadBatches } from "../uploadBatches";
import { IMPORT_LIMITS } from "../importLimits";

const MB = 1_000_000;
const f = (name: string, mb: number) => ({ name, size: mb * MB });
const names = (bs: { name: string }[][]) => bs.map((b) => b.map((x) => x.name));

describe("planUploadBatches", () => {
  it("small files go together in one request", () => {
    expect(names(planUploadBatches([f("a", 1), f("b", 2), f("c", 3)]).batches)).toEqual([["a", "b", "c"]]);
  });
  it("files each within the limit but together over it go in several requests, in order, none over the limit", () => {
    const { batches, tooLarge } = planUploadBatches([f("data", 80), f("codebook", 15), f("questionnaire", 10), f("wave2", 60)]);
    expect(names(batches)).toEqual([["data", "codebook"], ["questionnaire", "wave2"]]);
    for (const b of batches) expect(b.reduce((n, x) => n + x.size, 0)).toBeLessThanOrEqual(IMPORT_LIMITS.maxFileBytes);
    expect(tooLarge).toEqual([]);
  });
  it("a file of exactly the limit goes alone; one byte over is never sent, and the rest still go", () => {
    const exact = { name: "exact", size: IMPORT_LIMITS.maxFileBytes };
    const over = { name: "over", size: IMPORT_LIMITS.maxFileBytes + 1 };
    const { batches, tooLarge } = planUploadBatches([f("small", 1), exact, over, f("after", 1)]);
    expect(names(batches)).toEqual([["small"], ["exact"], ["after"]]);
    expect(tooLarge.map((x) => x.name)).toEqual(["over"]);
  });
  it("the per-request budget stays under the proxy's 100 MiB body limit", () => {
    expect(IMPORT_LIMITS.maxFileBytes).toBeLessThan(100 * 1024 * 1024);
  });
  it("nothing chosen: no requests", () => {
    expect(planUploadBatches([])).toEqual({ batches: [], tooLarge: [] });
  });
});
