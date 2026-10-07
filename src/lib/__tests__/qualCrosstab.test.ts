import { describe, expect, it } from "vitest";
import {
  cooccurrence,
  themesByAttribute,
  usableAttributes,
  type CrosstabRespondent,
} from "../qualCrosstab";

const codes = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
];
const people: CrosstabRespondent[] = [
  {
    key: "1",
    label: "P1",
    attributes: { Sex: "F", Id: "x1" },
    codeTurns: { a: 2, b: 1 },
  },
  {
    key: "2",
    label: "P2",
    attributes: { Sex: "F", Id: "x2" },
    codeTurns: { a: 1 },
  },
  {
    key: "3",
    label: "P3",
    attributes: { Sex: "M", Id: "x3" },
    codeTurns: { b: 3 },
  },
  { key: "4", label: "P4", attributes: { Id: "x4" }, codeTurns: {} },
];

describe("usableAttributes", () => {
  it("keeps attributes with groups and drops per-person ones", () => {
    expect(usableAttributes(people)).toEqual(["Sex"]);
  });
});

describe("themesByAttribute", () => {
  it("counts respondents against each group's base", () => {
    const t = themesByAttribute(people, codes, "Sex");
    expect(t.unknown).toBe(1);
    expect(t.groups.map((g) => [g.value, g.base, g.small])).toEqual([
      ["F", 2, true],
      ["M", 1, true],
    ]);
    const a = t.rows[0].cells;
    expect(a[0]).toMatchObject({ withTheme: 2, base: 2, share: 1, turns: 3 });
    expect(a[1]).toMatchObject({ withTheme: 0, base: 1, share: 0 });
  });
});

describe("cooccurrence", () => {
  it("counts respondents and turns with both themes", () => {
    const c = cooccurrence(people, codes, [["a", "b"], ["a"], ["b"]]);
    expect(c.pairs).toEqual([
      [2, 1],
      [1, 2],
    ]);
    expect(c.turnPairs).toEqual([
      [2, 1],
      [1, 2],
    ]);
    expect(c.respondents).toBe(4);
  });
});
