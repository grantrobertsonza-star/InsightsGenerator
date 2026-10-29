// CB1: finding a question in a long variable list. Pure; the order and the matches a researcher relies on.
import { describe, expect, it } from "vitest";
import { searchVariables } from "../variableSearch";

const VARS = [
  { name: "RespID", label: "Respondent ID" },
  { name: "aware_b01", label: "Prompted resolved recognition Toyota" },
  { name: "aware_b02", label: "Prompted resolved recognition BMW" },
  { name: "consider_b01", label: "Consideration for next purchase Toyota" },
  { name: "Q12_3", label: "Q12_3" },
  { name: "Q1", label: "Overall satisfaction with the dealer" },
  { name: "Q12", label: "How likely are you to recommend us?" },
  { name: "AgentEmpathy_0to10", label: "AgentEmpathy_0to10" },
  { name: "wgt", label: "Weight" },
];
const names = (q: string) => searchVariables(q, VARS).map((v) => v.name);

describe("variable search", () => {
  it("an empty search keeps the file's order", () => expect(names("  ")).toEqual(VARS.map((v) => v.name)));
  it("research words find their other forms: awareness finds recognition", () => expect(names("awareness")).toEqual(["aware_b01", "aware_b02"]));
  it("several words narrow, in any order", () => expect(names("toyota aware")).toEqual(["aware_b01"]));
  it("nps finds recommend; satisfaction finds satisfaction", () => {
    expect(names("nps")).toEqual(["Q12"]);
    expect(names("satisfied")).toEqual(["Q1"]);
  });
  it("the name itself first, then names starting with it", () => expect(names("q12").slice(0, 2)).toEqual(["Q12", "Q12_3"]));
  it("words inside a run-together name", () => expect(names("empathy")).toEqual(["AgentEmpathy_0to10"]));
  it("nothing matching gives nothing, never the whole list", () => expect(names("zzz")).toEqual([]));
});
