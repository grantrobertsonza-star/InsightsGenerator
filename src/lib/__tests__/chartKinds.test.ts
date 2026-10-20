import { describe, expect, it } from "vitest";
import { histogramSource } from "../chartKinds";

describe("histogramSource", () => {
  it("uses the engine's bins only for an unlabelled question with more than 25 values", () => {
    expect(histogramSource({ labelled: false, nDistinct: 60 })).toBe("bins");
    expect(histogramSource({ labelled: false, nDistinct: 25 })).toBe("values");
    expect(histogramSource({ labelled: true, nDistinct: 60 })).toBe("values");
    expect(histogramSource({ labelled: false, nDistinct: 11 })).toBe("values");
  });
});
