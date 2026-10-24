import { describe, expect, it } from "vitest";
import {
  analyticsStatus,
  codingStatus,
  decisionsStatus,
  findingsStatus,
  insightsStatus,
  nextStep,
  recommendationsStatus,
  reportStatus,
  reportsStatus,
  researchQualityStatus,
  sectionStatuses,
  type ProjectStageFacts,
} from "../sectionStatus";

const facts = (over: Partial<ProjectStageFacts> = {}): ProjectStageFacts => ({
  import: { files: [{ documentId: "d1", filename: "survey.sav", kind: "table", processing: "read", acceptance: "accepted", readError: null, linksToCheck: 0 }], tablesReadFailed: false },
  objectives: {
    objectives: [{ id: "o1", text: "Understand lapse", status: "accepted", unscoredReason: null, scoreTier: "strong" }],
    qualityStatusFailed: false,
    scoresUnavailable: false,
    failedFill: null,
    fillRecordFailed: false,
    coverage: [],
    coverageError: null,
  },
  researchQuality: { latest: null, hasContextFile: true },
  decisions: { pending: 0, accepted: 1, refreshPending: false },
  crosstabs: { files: [{ id: "d1", filename: "survey.sav", state: "ready", draftTables: 0, committedTables: 3 }], tablesReadFailed: false },
  analytics: { analysisFindings: 0 },
  coding: { transcripts: [] },
  reports: { reports: [], processErrors: [] },
  findings: { total: 10, pending: 0, accepted: 8, rejected: 2, hasSources: true },
  insights: { total: 4, inUse: 4 },
  recommendations: { total: 4, pending: 0, accepted: 4 },
  report: { generatedAt: "2026-10-23T10:00:00Z", error: null },
  ...over,
});

describe("module rules", () => {
  it("optional modules are Not used until used, and never pass for ready work", () => {
    expect(researchQualityStatus({ latest: null, hasContextFile: false }).state).toBe("not_used");
    expect(researchQualityStatus({ latest: "running", hasContextFile: true }).state).toBe("working");
    expect(researchQualityStatus({ latest: "partial", hasContextFile: true }).state).toBe("needs_you");
    expect(researchQualityStatus({ unreadable: true }).state).toBe("couldnt_check");
    expect(analyticsStatus({ analysisFindings: 0 }).state).toBe("not_used");
    expect(analyticsStatus({ analysisFindings: 2 }).headline).toBe("2 analysis findings posted");
    expect(codingStatus({ transcripts: [] }).state).toBe("not_used");
    expect(reportsStatus({ reports: [], processErrors: [] }).state).toBe("not_used");
  });

  it("decisions: no decision and suggestions need you; an unreadable refresh record is couldn't check", () => {
    expect(decisionsStatus({ pending: 0, accepted: 0, refreshPending: false }).issues.map((i) => i.key)).toEqual(["none"]);
    expect(decisionsStatus({ pending: 2, accepted: 1, refreshPending: false }).issues[0].text).toBe("Review 2 suggested decisions");
    expect(decisionsStatus({ pending: 0, accepted: 1, refreshPending: null }).state).toBe("couldnt_check");
    expect(decisionsStatus({ pending: 0, accepted: 2, refreshPending: false })).toMatchObject({ state: "ready", headline: "2 decisions set" });
  });

  it("coding links an unaccepted setup to the transcript's Setup tab and an uncoded transcript to Coding", () => {
    const s = codingStatus({
      transcripts: [
        { id: "t1", filename: "a.docx", setupAccepted: false, coded: false },
        { id: "t2", filename: "b.docx", setupAccepted: true, coded: false },
        { id: "t3", filename: "c.docx", setupAccepted: true, coded: true },
      ],
    });
    expect(s.state).toBe("needs_you");
    expect(s.headline).toBe("1 of 3 transcripts coded");
    expect(s.issues.map((i) => i.target)).toEqual([{ kind: "import_file", documentId: "t1", tab: "setup" }, { kind: "section", id: "coding" }]);
  });

  it("findings: pending review needs you; inside a project a changed design needs you and an unknown one is couldn't check; contradictions are caveats", () => {
    expect(findingsStatus({ total: 5, pending: 2, accepted: 3, rejected: 0, hasSources: true }).headline).toBe("2 of 5 findings to review");
    const inside = findingsStatus({ total: 5, pending: 0, accepted: 5, rejected: 0, hasSources: true, attention: { contradictions: 1, designChanged: 0, designUnknown: 2, quoteNotFound: 0, claimsNotSupported: 0 } });
    expect(inside.state).toBe("couldnt_check");
    expect(inside.caveats.map((c) => c.key)).toEqual(["contradictions"]);
    expect(findingsStatus({ total: 0, pending: 0, accepted: 0, rejected: 0, hasSources: false }).issues[0].target).toEqual({ kind: "section", id: "upload" });
  });

  it("insights, recommendations and the report each say what comes first when there is nothing yet", () => {
    expect(insightsStatus({ total: 0, inUse: 0 }, 0).issues[0].text).toBe("Accept findings first");
    expect(insightsStatus({ total: 0, inUse: 0 }, 6).issues[0].text).toBe("Generate insights from 6 accepted findings");
    expect(insightsStatus({ total: 3, inUse: 3, support: { stale: 0, invalid: 1, unknown: 1 } }, 6).state).toBe("couldnt_check");
    expect(recommendationsStatus({ total: 0, pending: 0, accepted: 0 }, 0).issues[0].text).toBe("Insights come first");
    const recs = recommendationsStatus({ total: 4, pending: 1, accepted: 3, attention: { supportInvalid: 0, supportStale: 0, supportUnknown: 0, decisionEarlier: 2, decisionUnknown: 0, insightsWithoutRecommendation: 1 } }, 4);
    expect(recs.issues.map((i) => i.key)).toEqual(["pending", "missing"]);
    expect(recs.caveats.map((c) => c.key)).toEqual(["earlier"]);
    const noReport = reportStatus({ generatedAt: null, error: "Model unavailable." }, { insightsInUse: 2, acceptedRecommendations: 1 });
    expect(noReport.issues.map((i) => i.text)).toEqual(["The last generation failed: Model unavailable", "Generate the insights report"]);
    expect(reportStatus({ generatedAt: "2026-10-23T10:00:00Z", error: null }, { insightsInUse: 2, acceptedRecommendations: 1 }).headline).toBe("Report generated 2026-10-23");
  });
});

describe("sections", () => {
  it("a complete project is ready in every section, with unused optional modules left out", () => {
    const s = sectionStatuses(facts());
    expect(s.map((x) => [x.id, x.state])).toEqual([
      ["prepare", "ready"],
      ["analyse", "ready"],
      ["develop", "ready"],
      ["deliver", "ready"],
    ]);
    expect(s[0].modules.find((m) => m.id === "research-quality")!.status.state).toBe("not_used");
    expect(nextStep(s)).toBeNull();
  });

  it("a section takes its worst module in use and names the modules that need you; the next step is the first in workflow order", () => {
    const s = sectionStatuses(facts({ decisions: { pending: 1, accepted: 0, refreshPending: false }, findings: { total: 10, pending: 4, accepted: 4, rejected: 2, hasSources: true } }));
    expect(s[0]).toMatchObject({ state: "needs_you", headline: "Business decisions needs you" });
    expect(s[2].state).toBe("needs_you");
    expect(nextStep(s)).toEqual({ section: "prepare", moduleId: "decisions", label: "Business decisions", text: "Review 1 suggested decision" });
  });

  it("couldn't check outranks needs you in a section", () => {
    const s = sectionStatuses(facts({ crosstabs: { files: [{ id: "d1", filename: "survey.sav", state: "ready", draftTables: 2, committedTables: 0 }], tablesReadFailed: true } }));
    expect(s[1].state).toBe("couldnt_check");
  });

  it("a qualitative-only project's Analyse section is judged by Coding, not by an empty Cross tabs", () => {
    const s = sectionStatuses(
      facts({
        import: { files: [{ documentId: "t1", filename: "i.docx", kind: "transcript", processing: "read", acceptance: "accepted", readError: null, linksToCheck: 0 }], tablesReadFailed: false },
        crosstabs: { files: [], tablesReadFailed: false },
        coding: { transcripts: [{ id: "t1", filename: "i.docx", setupAccepted: true, coded: true }] },
      }),
    );
    const analyse = s.find((x) => x.id === "analyse")!;
    expect(analyse.state).toBe("ready");
    expect(analyse.modules.find((m) => m.id === "crosstabs")!.status.state).toBe("not_used");
  });

  it("with reports and no data file, Analyse is judged by Secondary analysis; with nothing at all it asks for a data file", () => {
    const s = sectionStatuses(facts({ crosstabs: { files: [], tablesReadFailed: false }, reports: { reports: [{ id: "r", filename: "r.pdf", failed: false, claims: 3 }], processErrors: [] } }));
    expect(s[1].state).toBe("ready");
    const empty = sectionStatuses(facts({ crosstabs: { files: [], tablesReadFailed: false } }));
    expect(empty[1]).toMatchObject({ state: "needs_you", headline: "Cross tabs needs you" });
  });
});
