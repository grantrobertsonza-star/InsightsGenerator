import { describe, it, expect } from "vitest";
import {
  CONTRADICTED_TIER,
  availableNetNewSources,
  classifyFindingDiscovery,
  classifyInputCompleteness,
  contradictionRationale,
  summarizeSynthesizedProvenance,
  verificationBasisFor,
  verificationCaption,
} from "../discoveryClassification";

describe("classifyFindingDiscovery", () => {
  it("treats a stated or coded finding as validated: it IS what the report said", () => {
    expect(
      classifyFindingDiscovery({
        origin: "stated",
        corroboratesReportClaim: false,
      }),
    ).toEqual({
      type: "validated",
      source: null,
    });
    expect(
      classifyFindingDiscovery({
        origin: "coded",
        corroboratesReportClaim: false,
      }).type,
    ).toBe("validated");
  });

  it("treats a computed finding no report claim points at as net-new, mined from the data", () => {
    expect(
      classifyFindingDiscovery({
        origin: "generated",
        corroboratesReportClaim: false,
      }),
    ).toEqual({
      type: "net_new",
      source: "raw_data_mining",
    });
  });

  it("treats a computed finding that a report claim is grounded in as validated", () => {
    expect(
      classifyFindingDiscovery({
        origin: "generated",
        corroboratesReportClaim: true,
      }),
    ).toEqual({
      type: "validated",
      source: null,
    });
  });
});

describe("summarizeSynthesizedProvenance", () => {
  it("is net-new by synthesis even when every member is a validated report claim, and says so", () => {
    const result = summarizeSynthesizedProvenance(["validated", "validated"]);
    expect(result.type).toBe("net_new");
    expect(result.source).toBe("synthesis");
    expect(result.validatedMemberCount).toBe(2);
    expect(result.netNewMemberCount).toBe(0);
    expect(result.caption).toContain("2 claims the report itself made");
    expect(result.caption).toContain("none of them said alone");
  });

  it("reports a mix of validated and net-new members", () => {
    const result = summarizeSynthesizedProvenance([
      "validated",
      "net_new",
      "net_new",
    ]);
    expect(result.validatedMemberCount).toBe(1);
    expect(result.netNewMemberCount).toBe(2);
    expect(result.caption).toContain("1 claim from the report");
    expect(result.caption).toContain("2 net-new findings");
  });

  it("reports an insight built only from net-new findings", () => {
    const result = summarizeSynthesizedProvenance(["net_new"]);
    expect(result.caption).toContain(
      "1 net-new finding the report did not contain",
    );
  });

  it("does not blow up on an empty member list", () => {
    const result = summarizeSynthesizedProvenance([]);
    expect(result.type).toBe("net_new");
    expect(result.caption).toContain("No source findings");
  });
});

describe("input completeness", () => {
  it("names all four states", () => {
    expect(classifyInputCompleteness({ hasReport: true, hasData: true })).toBe(
      "report_and_data",
    );
    expect(classifyInputCompleteness({ hasReport: true, hasData: false })).toBe(
      "report_only",
    );
    expect(classifyInputCompleteness({ hasReport: false, hasData: true })).toBe(
      "data_only",
    );
    expect(
      classifyInputCompleteness({ hasReport: false, hasData: false }),
    ).toBe("none");
  });

  it("closes raw-data mining as a source of net-new insight when only a report was supplied", () => {
    expect(availableNetNewSources("report_only")).toEqual(["synthesis"]);
    expect(availableNetNewSources("report_and_data")).toEqual([
      "raw_data_mining",
      "synthesis",
    ]);
    expect(availableNetNewSources("data_only")).toEqual([
      "raw_data_mining",
      "synthesis",
    ]);
    expect(availableNetNewSources("none")).toEqual([]);
  });

  it("never advertises evidence memory, which is not built yet", () => {
    for (const state of [
      "report_and_data",
      "report_only",
      "data_only",
      "none",
    ] as const) {
      expect(availableNetNewSources(state)).not.toContain("evidence_memory");
    }
  });
});

describe("verification basis", () => {
  it("is data-backed for computed findings, grounded claims, and chains that relied on computed evidence", () => {
    expect(
      verificationBasisFor({
        origin: "generated",
        groundedByComputedFinding: false,
        reliedOnComputedEvidence: false,
      }),
    ).toBe("data_backed");
    expect(
      verificationBasisFor({
        origin: "stated",
        groundedByComputedFinding: true,
        reliedOnComputedEvidence: false,
      }),
    ).toBe("data_backed");
    expect(
      verificationBasisFor({
        origin: "stated",
        groundedByComputedFinding: false,
        reliedOnComputedEvidence: true,
      }),
    ).toBe("data_backed");
  });

  it("is report-only when a claim was judged on the report's own wording alone", () => {
    expect(
      verificationBasisFor({
        origin: "stated",
        groundedByComputedFinding: false,
        reliedOnComputedEvidence: false,
      }),
    ).toBe("report_only");
    expect(
      verificationBasisFor({
        origin: "coded",
        groundedByComputedFinding: false,
        reliedOnComputedEvidence: false,
      }),
    ).toBe("report_only");
  });

  it("says nothing for a data-backed verdict", () => {
    expect(verificationCaption("data_backed", "report_and_data")).toBeNull();
    expect(verificationCaption("data_backed", "report_only")).toBeNull();
  });

  it("tells a client the numbers were not supplied when the whole run is report-only", () => {
    const caption = verificationCaption("report_only", "report_only");
    expect(caption).toContain("Statistical verification unavailable");
    expect(caption).toContain("no underlying data was supplied");
  });

  it("distinguishes 'no data supplied' from 'data supplied but nothing matches this claim'", () => {
    const caption = verificationCaption("report_only", "report_and_data");
    expect(caption).toContain("Not checked against the supplied data");
    expect(caption).not.toContain("unavailable");
  });
});

describe("contradiction rationale", () => {
  it("forces the contradicted tier to not_supported", () => {
    expect(CONTRADICTED_TIER).toBe("not_supported");
  });

  it("names what contradicted the claim and keeps the earlier assessment", () => {
    const text = contradictionRationale({
      kind: "finding",
      contradictingText: "Usage fell 12% in the 18-24 segment.",
      detail: "The report claimed growth in every segment.",
      previousRationale: "Plausible and internally coherent.",
    });
    expect(text).toContain("Contradicted by a net-new finding");
    expect(text).toContain("Usage fell 12% in the 18-24 segment.");
    expect(text).toContain("The report claimed growth in every segment.");
    expect(text).toContain(
      "Earlier assessment: Plausible and internally coherent.",
    );
  });

  it("omits the earlier-assessment clause when there was none", () => {
    const text = contradictionRationale({
      kind: "synthesized_insight",
      contradictingText: "Trust, not price, drives churn",
      detail: "The report named price as the driver.",
      previousRationale: null,
    });
    expect(text).toContain("net-new synthesized insight");
    expect(text).not.toContain("Earlier assessment");
  });
});
