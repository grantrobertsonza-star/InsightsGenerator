import { describe, expect, it } from "vitest";
import { computeTableQuality, type CellValue } from "../dataQuality";
const target = (headers: string[], rows: Record<string, CellValue>[]) => computeTableQuality(headers, rows, "raw").variableDetails.find(v => v.name === "answer")!;
describe("wide import routing preserves the existing research rule", () => {
  it("prefers a more complete fitting gate and keeps the first equally complete fit", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ early: i < 30 ? null : i < 100 ? 0 : 1, complete: i < 100 ? 0 : 1, tie: i < 100 ? 0 : 1, answer: i < 100 ? null : 1 + i % 2 }));
    expect(target(["early", "complete", "tie", "answer"], rows).routedBy).toBe("complete");
    expect(target(["tie", "complete", "early", "answer"], rows).routedBy).toBe("tie");
  });
  it("rejects a gate with 16 keys even when it perfectly partitions the gaps", () => {
    const rows = Array.from({ length: 320 }, (_, i) => ({ tooMany: i % 16, complete: i % 16 < 8 ? 0 : 1, answer: i % 16 < 8 ? null : 1 + i % 2 }));
    expect(target(["tooMany", "complete", "answer"], rows).routedBy).toBe("complete");
  });
  it("keeps the 95 percent boundary, refuses an imperfect split and recovers on corrected input", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ gate: i < 100 ? 0 : 1, answer: i < 95 || i >= 100 && i < 105 ? null : 1 + i % 2 }));
    expect(target(["gate", "answer"], rows).routedBy).toBe("gate");
    const broken = rows.map((r, i) => i === 105 ? { ...r, answer: null } : r);
    expect(target(["gate", "answer"], broken).routedBy).toBeNull();
    expect(target(["gate", "answer"], rows).routedBy).toBe("gate");
  });
  it("keeps the minimum-case boundary", () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ gate: i < 25 ? 0 : 1, answer: i < 25 ? null : 1 + i % 2 }));
    expect(target(["gate", "answer"], rows.slice(0, 49)).routedBy).toBeUndefined();
    expect(target(["gate", "answer"], rows).routedBy).toBe("gate");
  });
});
