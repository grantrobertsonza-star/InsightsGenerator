import { describe, expect, it } from "vitest";
import {
  computeDataQuality,
  countSentences,
  countWords,
  spread,
} from "../qualQuality";

function build(respondents: number, codesFor: (r: number) => string[]) {
  const segments = [];
  const assignments = new Map<string, string[]>();
  let index = 0;
  for (let r = 1; r <= respondents; r++) {
    segments.push({
      id: `m${r}`,
      index: index++,
      speaker: "M",
      role: "moderator",
      text: "Tell me more?",
    });
    segments.push({
      id: `p${r}`,
      index: index++,
      speaker: `P${r}`,
      role: "participant",
      text: "The network drops every day. Support does not help.",
    });
    assignments.set(`p${r}`, codesFor(r));
  }
  return { segments, assignments };
}

describe("counting", () => {
  it("counts words and sentences", () => {
    expect(countWords("It dropped, again. Twice!")).toBe(4);
    expect(countSentences("It dropped. Twice! Why?")).toBe(3);
    expect(countSentences("no punctuation")).toBe(1);
  });
  it("summarises spread", () => {
    expect(spread([1, 2, 3, 4, 5])).toEqual({
      median: 3,
      min: 1,
      max: 5,
      q1: 2,
      q3: 4,
    });
    expect(spread([])).toBeNull();
  });
});

describe("computeDataQuality", () => {
  const codes = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
  ];

  it("reports volume and moderator share", () => {
    const { segments, assignments } = build(6, () => ["a"]);
    const q = computeDataQuality({ segments, assignments, codes });
    expect(q.respondents).toBe(6);
    expect(q.participantTurns).toBe(6);
    expect(q.moderatorTurns).toBe(6);
    expect(q.codedShare).toBe(1);
    expect(q.moderatorWordShare).toBeGreaterThan(0);
    expect(q.thinThemes.map((t) => t.codeName)).toEqual(["B", "C"]);
  });

  it("builds a saturation curve that flattens", () => {
    const { segments, assignments } = build(10, (r) =>
      r <= 2 ? ["a", "b"] : r === 3 ? ["c"] : ["a"],
    );
    const q = computeDataQuality({ segments, assignments, codes });
    expect(q.saturation?.cumulativeCodes).toEqual([
      2, 2, 3, 3, 3, 3, 3, 3, 3, 3,
    ]);
    expect(q.saturation?.simple?.newInRun).toBe(0);
    expect(q.saturation?.simple?.ratio).toBe(0);
    expect(q.saturation?.themes[2].firstSeenAt).toBe(3);
  });

  it("is repeatable and skips the curve for tiny samples", () => {
    const { segments, assignments } = build(8, (r) => [codes[r % 3].id]);
    const one = computeDataQuality({ segments, assignments, codes });
    const two = computeDataQuality({ segments, assignments, codes });
    expect(one.saturation?.permuted).toEqual(two.saturation?.permuted);
    const small = build(2, () => ["a"]);
    expect(computeDataQuality({ ...small, codes }).saturation).toBeNull();
  });

  it("warns when a transcript was cut", () => {
    const { segments, assignments } = build(4, () => ["a"]);
    const q = computeDataQuality({
      segments,
      assignments,
      codes,
      truncated: true,
    });
    expect(q.notes.some((n) => n.includes("cut before coding"))).toBe(true);
  });
});
