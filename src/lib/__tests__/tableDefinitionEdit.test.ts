import { describe, expect, it } from "vitest";
import { builderChoicesFrom } from "../tableDefinitionEdit";
import type { CrosstabRequest } from "../parseStatsFile";

const request: CrosstabRequest = {
  columnVars: ["region", "set:brands", "gone_banner"],
  rowItems: [
    { key: "sat", label: "Satisfaction", vars: ["sat"], groups: [{ label: "Top two", cats: ["Satisfied", "Very satisfied"] }] },
    { key: "old", label: "Dropped in wave 2", vars: ["old_q"] },
    { key: "nets-1", label: "Nets", vars: [], kind: "nets", nets: [{ label: "Any", vars: ["a1", "a2"] }, { label: "Old", vars: ["a1", "old_a"] }] },
  ],
  weightVar: "w1",
  design: { psu: "psu", strata: null },
  correction: "bonferroni",
  excludeDk: false,
  meanRows: true,
  filters: [{ variable: "region", op: "in", values: ["North"] }, { variable: "old_filter", op: "in", values: ["x"] }],
  columnGroups: { region: [{ label: "Coast", cats: ["North", "South"] }], gone_banner: [{ label: "G", cats: ["1"] }] },
  layerVariable: "age",
};
const wave2 = new Set(["region", "set:brands", "sat", "a1", "a2", "age"]);

describe("Edit in Build table: a saved table's choices for the file now open", () => {
  it("keeps every choice the file holds, with its groups, nets, filters and settings", () => {
    const c = builderChoicesFrom(request, (n) => wave2.has(n));
    expect(c.columnVars).toEqual(["region", "set:brands"]);
    expect(c.rowItems.map((r) => r.key)).toEqual(["sat"]);
    expect(c.rowItems[0].groups).toEqual([{ label: "Top two", cats: ["Satisfied", "Very satisfied"] }]);
    expect(c.nets).toEqual([{ label: "Any", vars: ["a1", "a2"] }]);
    expect(c.filters).toEqual([{ variable: "region", op: "in", values: ["North"] }]);
    expect(c.columnGroups).toEqual({ region: [{ label: "Coast", cats: ["North", "South"] }] });
    expect([c.correction, c.excludeDk, c.meanRows, c.layerVariable]).toEqual(["bonferroni", false, true, "age"]);
  });
  it("names what the file does not hold, and leaves it out", () => {
    expect(builderChoicesFrom(request, (n) => wave2.has(n)).missing.sort()).toEqual(["gone_banner", "old_a", "old_filter", "old_q"]);
  });
  it("defaults of a request saved before a setting existed: false discovery rate, non-answers excluded, no mean, no layer", () => {
    const c = builderChoicesFrom({ columnVars: [], rowItems: [{ key: "sat", label: "S", vars: ["sat"] }], weightVar: null }, () => true);
    expect([c.correction, c.excludeDk, c.meanRows, c.layerVariable, c.missing]).toEqual(["fdr", true, false, "", []]);
  });
});
