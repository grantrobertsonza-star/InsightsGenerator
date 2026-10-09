import { describe, expect, it } from "vitest";
import { buildStatedRouting } from "../statedRouting";
import { computeTableQuality } from "../dataQuality";
import { parseRouting } from "../routingParse";

const yesNo = [{ code: "1", label: "Yes" }, { code: "2", label: "No" }];

describe("buildStatedRouting", () => {
  it("needs the gate question linked and with options", () => {
    const vars = [{ name: "Q5", label: "Bank account" }, { name: "Q6", label: "Bank fees" }];
    const routing = parseRouting("Ask if Q5 = 1");
    expect(buildStatedRouting([{ variable: "Q6", code: "Q6", options: [], routing }], vars)).toEqual([]);
    const r = buildStatedRouting(
      [
        { variable: "Q5", code: "Q5", options: yesNo, routing: null },
        { variable: "Q6", code: "Q6", options: [], routing, routingText: "Ask if Q5 = 1" },
      ],
      vars,
    );
    expect(r.length).toBe(1);
    expect(r[0].header).toBe("Bank fees");
    expect(r[0].gates.Q5.header).toBe("Bank account");
  });
});

describe("stated routing in computeTableQuality", () => {
  const rows = Array.from({ length: 100 }, (_, i) => {
    const has = i < 60;
    return {
      "Bank account": has ? "Yes" : "No",
      // Asked only of account holders; 3 of the 60 eligible left it empty.
      "Bank fees": has ? (i < 57 ? "Low" : null) : null,
    };
  });
  const headers = ["Bank account", "Bank fees"];
  const stated = buildStatedRouting(
    [
      { variable: "Q5", code: "Q5", options: yesNo, routing: null },
      { variable: "Q6", code: "Q6", options: [], routing: parseRouting("Ask if Q5 = 1"), routingText: "Ask if Q5 = 1" },
    ],
    [{ name: "Q5", label: "Bank account" }, { name: "Q6", label: "Bank fees" }],
  );

  it("sets aside gaps among people who were not asked, and reports the rest", () => {
    const q = computeTableQuality(headers, rows, "raw", stated);
    const v = q.variableDetails.find((x) => x.name === "Bank fees")!;
    expect(v.routedBy).toBe("Bank account");
    expect(v.routedSource).toBe("questionnaire");
    expect(v.askedCount).toBe(60);
    expect(v.missingAsked).toBe(3);
    expect(q.unexplainedMissingPct).toBeLessThan(q.missingPct);
  });

  it("still flags a stated-routing variable that is empty among those asked", () => {
    const bad = rows.map((r, i) => (i < 60 ? { ...r, "Bank fees": i < 20 ? "Low" : null } : r));
    const q = computeTableQuality(headers, bad, "raw", stated);
    expect(q.checks.find((c) => c.id === "missing_by_variable")?.status).not.toBe("pass");
  });
});
