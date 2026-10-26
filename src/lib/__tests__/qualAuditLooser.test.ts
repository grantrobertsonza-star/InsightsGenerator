import { describe, expect, it } from "vitest";
import { looserAgreement } from "../qualAudit";

// Codes 1 and 2 sit under theme "Price"; code 3 under "Service"; code 4 has no theme.
const themeOf = (c: number) => (c === 1 || c === 2 ? "Price" : c === 3 ? "Service" : null);

describe("looserAgreement", () => {
  it("counts a swap between codes of one theme as theme agreement but not as full overlap", () => {
    const r = looserAgreement([[[1], [2]]], themeOf);
    expect(r.themeShare).toBe(1);
    expect(r.overlap).toBe(0);
  });

  it("does not count a change of theme as agreement", () => {
    const r = looserAgreement([[[1], [3]]], themeOf);
    expect(r.themeShare).toBe(0);
  });

  it("gives partial credit for shared codes", () => {
    const r = looserAgreement([[[1, 2, 3], [1, 2, 3, 4]]], themeOf);
    expect(r.overlap).toBeCloseTo(0.75);
  });

  it("treats two empty runs as agreeing", () => {
    const r = looserAgreement([[[], []]], themeOf);
    expect(r.overlap).toBe(1);
  });

  it("reports no theme figure when no code has a theme", () => {
    const r = looserAgreement([[[4], [4]]], () => null);
    expect(r.themeShare).toBeNull();
    expect(r.overlap).toBe(1);
  });

  it("averages over turns and over run pairs", () => {
    const r = looserAgreement(
      [
        [[1], [1], [1]],
        [[1], [2], [2]],
      ],
      themeOf,
    );
    expect(r.themeShare).toBe(1);
    // second turn: pairs (1,2)=0, (1,2)=0, (2,2)=1 -> 1/3; first turn 1; mean = 2/3
    expect(r.overlap).toBeCloseTo(2 / 3);
  });
});
