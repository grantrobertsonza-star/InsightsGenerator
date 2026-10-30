// Multiple-response families (Grant, 2026-10-22: the FinScope stem EN20 showed No match although
// the data has EN20_1 to EN20_n). Pure matcher, no database. Uses only matchItems, so the same file
// runs against the matcher before this change as a control.
import { describe, expect, it } from "vitest";
import { matchItems } from "../instrumentMatch";

// "Confirm same-code matches" confirms suggestions at or above this (AUTO_CONFIRM_MIN in instruments.ts).
const CONFIRM_ALL = 0.9;

const networks = ["Vodacom", "MTN", "Cell C", "Telkom", "Rain", "Other"];
const en20 = Array.from({ length: 12 }, (_, i) => ({
  name: `EN20_${i + 1}`,
  label: `EN20_${i + 1}. With which mobile networks or companies do you have a data SIM card? ${networks[i % 6]}`,
}));
const others = [
  { name: "EN2", label: "EN2. Do you own a mobile phone" },
  { name: "EN201", label: "EN201. A separate question" },
  { name: "EN202", label: "EN202. Another separate question" },
  { name: "EN22a", label: "EN22a. Prepaid or contract" },
  { name: "EN22b", label: "EN22b. Top-up amount" },
  { name: "Q3_1", label: "Grid row one" },
  { name: "Q3_2", label: "Grid row two" },
];
const vars = [...en20, ...others];
const of = (m: ReturnType<typeof matchItems>, itemId: string) => m.filter((c) => c.itemId === itemId);

describe("multiple-response families", () => {
  it("links a stem to every variable named after its code, at the confirm-all level", () => {
    const m = matchItems([{ id: "stem", code: "EN20", text: "(Mobile networks or companies used for data/data SIM cards)" }], vars);
    const links = of(m, "stem");
    expect(links.map((c) => c.variable).sort()).toEqual(en20.map((v) => v.name).sort());
    expect(links.every((c) => c.method === "stem" && c.confidence >= CONFIRM_ALL)).toBe(true);
  });

  it("is not taken apart by another question's wording", () => {
    const m = matchItems(
      [
        { id: "stem", code: "EN20", text: "(Mobile networks or companies used for data/data SIM cards)" },
        { id: "other", code: "EN19", text: "With which mobile networks or companies do you have a data SIM card?" },
      ],
      vars,
    );
    expect(of(m, "stem")).toHaveLength(12);
    expect(of(m, "other")).toEqual([]);
  });

  it("stops at the end of the code: EN2 takes EN2 only, EN20 never takes EN201", () => {
    const m = matchItems(
      [
        { id: "en2", code: "EN2", text: "Do you own a mobile phone?" },
        { id: "en20", code: "EN20", text: "Mobile networks used for data" },
      ],
      vars,
    );
    expect(of(m, "en2").map((c) => c.variable)).toEqual(["EN2"]);
    expect(of(m, "en20").map((c) => c.variable)).not.toContain("EN201");
  });

  it("an exact code wins, and an exact-code variable stops the family", () => {
    const withExact = [...vars, { name: "EN20", label: "EN20 summary" }];
    const m = matchItems([{ id: "stem", code: "EN20", text: "Networks" }], withExact);
    expect(of(m, "stem").map((c) => c.variable)).toEqual(["EN20"]);
    const sub = matchItems(
      [
        { id: "stem", code: "EN20", text: "Networks" },
        { id: "first", code: "EN20_1", text: "Vodacom" },
      ],
      vars,
    );
    expect(of(sub, "first").map((c) => c.variable)).toEqual(["EN20_1"]);
    expect(of(sub, "stem").map((c) => c.variable)).not.toContain("EN20_1");
  });

  it("reads a code with trailing punctuation or an invisible space", () => {
    for (const code of ["EN20.", "EN20​", " EN20 ", "EN20)"]) {
      expect(of(matchItems([{ id: "stem", code, text: "Networks" }], vars), "stem"), code).toHaveLength(12);
    }
  });

  it("accepts _, . and - as the separator", () => {
    const dots = [{ name: "B4.1", label: "" }, { name: "B4.2", label: "" }];
    const dashes = [{ name: "C7-a", label: "" }, { name: "C7-b", label: "" }];
    expect(of(matchItems([{ id: "b", code: "B4", text: "x" }], dots), "b").every((c) => c.confidence >= CONFIRM_ALL)).toBe(true);
    expect(of(matchItems([{ id: "c", code: "C7", text: "x" }], dashes), "c")).toHaveLength(2);
  });

  it("keeps letter suffixes and a lone suffixed variable below the confirm-all level", () => {
    const letters = of(matchItems([{ id: "q", code: "EN22", text: "Data purchase" }], vars), "q");
    expect(letters.map((c) => c.variable).sort()).toEqual(["EN22a", "EN22b"]);
    expect(letters.every((c) => c.confidence < CONFIRM_ALL)).toBe(true);
    const lone = of(matchItems([{ id: "q", code: "Q8", text: "x" }], [{ name: "Q8_other", label: "" }]), "q");
    expect(lone).toHaveLength(1);
    expect(lone[0].confidence).toBeLessThan(CONFIRM_ALL);
  });

  it("a grid stem is linked to all its rows as before", () => {
    expect(of(matchItems([{ id: "g", code: "Q3", text: "Grid" }], vars), "g").map((c) => c.variable).sort()).toEqual(["Q3_1", "Q3_2"]);
  });

  it("an exact code keeps the digits apart: EN201 is not EN20_1, but Q1a is still Q1_a", () => {
    const m = matchItems(
      [
        { id: "en201", code: "EN201", text: "A separate question" },
        { id: "first", code: "EN20_1", text: "Vodacom" },
        { id: "dot", code: "EN20.2", text: "MTN" },
      ],
      vars,
    );
    expect(of(m, "en201").map((c) => c.variable)).toEqual(["EN201"]);
    expect(of(m, "first").map((c) => c.variable)).toEqual(["EN20_1"]);
    expect(of(m, "dot").map((c) => c.variable)).toEqual(["EN20_2"]);
    const loose = matchItems([{ id: "q", code: "Q1a", text: "x" }], [{ name: "Q1_a", label: "" }]);
    expect(of(loose, "q")).toMatchObject([{ variable: "Q1_a", method: "code", confidence: 1 }]);
  });
});
