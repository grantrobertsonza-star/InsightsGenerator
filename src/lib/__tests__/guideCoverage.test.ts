import { describe, expect, it } from "vitest";
import { computeGuideCoverage, guideHints, questionUnits } from "../guideCoverage";

const items = [
  { id: "a", order: 1, section: "Money habits", code: null, text: "How do you usually keep track of your money each month?" },
  { id: "b", order: 2, section: "Money habits", code: null, text: "Tell me about the last time you borrowed money" },
  { id: "c", order: 3, section: "Trust", code: null, text: "What makes you trust a bank with your savings?" },
  { id: "d", order: 4, section: "Trust", code: null, text: "Why?" },
];
const turns = [
  { index: 0, speaker: "M", role: "moderator" as const, text: "Thanks for coming. How do you usually keep track of your money each month?" },
  { index: 1, speaker: "R1", role: "participant" as const, text: "I write it in a book every week and check it on Fridays." },
  { index: 2, speaker: "M", role: "moderator" as const, text: "When did you last borrow money, and what happened? Did you tell your family?" },
  { index: 3, speaker: "R1", role: "participant" as const, text: "Last year, for school fees." },
  { index: 4, speaker: "M", role: "moderator" as const, text: "What colour is your phone case?" },
];

describe("guide coverage", () => {
  it("splits turns into questions", () => {
    expect(questionUnits("Thanks. How are you? And the kids?").length).toBe(2);
  });
  it("marks asked, reworded and not asked", () => {
    const c = computeGuideCoverage(items, turns);
    const by = Object.fromEntries(c.items.map((i) => [i.itemId, i]));
    expect(by.a.status).toBe("asked");
    expect(by.b.status).toBe("reworded");
    expect(by.c.status).toBe("not_asked");
    expect(by.d.status).toBe("unmatchable");
    expect(c.scored).toBe(3);
    expect(by.a.answerWords).toBeGreaterThan(5);
  });
  it("lists questions outside the guide", () => {
    const c = computeGuideCoverage(items, turns);
    expect(c.unscripted.length).toBeGreaterThan(0);
  });
  it("flags thin coverage", () => {
    const c = computeGuideCoverage(items, turns);
    expect(c.checks.find((x) => x.id === "coverage")?.status).toBe("warn");
  });
  it("offers sections then questions as hints", () => {
    const h = guideHints(items);
    expect(h[0]).toBe("Money habits");
    expect(h.length).toBeGreaterThan(2);
  });
});
