import { describe, expect, it } from "vitest";
import { groupVariables, profileVariables } from "../variableProfile";

const rows = Array.from({ length: 200 }, (_, i) => ({
  RespondentID: `R${i}`,
  Segment: ["A", "B", "C"][i % 3],
  CallReason_Billing: i % 4 === 0 ? 1 : 0,
  CallReason_Fault: i % 3 === 0 ? 1 : 0,
  CallReason_Other: i % 5 === 0 ? 1 : 0,
  Satisfaction_0to10: i % 11,
  Spend: i * 1.5 + 0.25,
  Comment: `text ${i}`,
}));
const headers = Object.keys(rows[0]);

describe("profileVariables", () => {
  it("classifies each variable", () => {
    const p = Object.fromEntries(profileVariables(headers, rows).map((v) => [v.name, v]));
    expect(p.RespondentID.kind).toBe("text");
    expect(p.Segment.kind).toBe("category");
    expect(p.Segment.suggestedRole).toBe("across");
    expect(p.CallReason_Billing.kind).toBe("flag");
    expect(p.Satisfaction_0to10.kind).toBe("scale");
    expect(p.Spend.kind).toBe("number");
    expect(p.Comment.kind).toBe("text");
  });
});

describe("groupVariables", () => {
  it("groups shared-prefix flags as one multi-response question", () => {
    const groups = groupVariables(profileVariables(headers, rows));
    expect(groups).toEqual([
      {
        key: "CallReason",
        label: "CallReason",
        type: "multi_response",
        members: ["CallReason_Billing", "CallReason_Fault", "CallReason_Other"],
      },
    ]);
  });
});
