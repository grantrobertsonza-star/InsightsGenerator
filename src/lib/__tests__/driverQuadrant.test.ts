import { describe, expect, it } from "vitest";
import { kanoPlace } from "../driverQuadrant";

describe("kanoPlace", () => {
  const pts = [
    { name: "A", derived: 0.3, stated: 80 },
    { name: "B", derived: 0.3, stated: 40 },
    { name: "C", derived: 0.05, stated: 80 },
    { name: "D", derived: 0.05, stated: 40 },
  ];
  it("puts each corner in its own quadrant", () => {
    const q = Object.fromEntries(kanoPlace(pts).map((p) => [p.name, p.quadrant]));
    expect(q).toEqual({ A: "satisfiers", B: "exciters", C: "mustBes", D: "indifference" });
  });
  it("centres both axes on the middle of the questions", () => {
    const placed = kanoPlace(pts);
    expect(placed.reduce((a, p) => a + p.zx, 0)).toBeCloseTo(0, 10);
    expect(placed.reduce((a, p) => a + p.zy, 0)).toBeCloseTo(0, 10);
  });
  it("does not divide by zero when every question has the same score", () => {
    const placed = kanoPlace(pts.map((p) => ({ ...p, stated: 50 })));
    expect(placed.every((p) => p.zx === 0)).toBe(true);
  });
});
