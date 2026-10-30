// Section dashboards (Grant, 2026-10-23, 3001): one dashboard per sidebar group (Prepare, Analyse,
// Develop findings, Deliver) with a status card per module, and an overall row per project on the
// main dashboard. The module rules for Import, Objectives and Cross tabs are in stageStatus.ts; the
// others are here, with the section roll-up. Pure: every rule reads facts loaded elsewhere
// (projectStageFacts.ts, and the project page's fuller checks), and calls nothing.
//
// A module that is optional and not used in this project (Research quality, Analytics, Coding with
// no transcripts, Secondary analysis with no reports) is "Not used": shown, but left out of its
// section's state, so an unused optional tool never holds a section back or passes for ready work.
//
// Fuller checks (a preview's identity, data quality flags, design freshness, support status) are
// only loaded inside a project. Where a fact is absent (undefined) its items are not produced, and
// the main dashboard says its status is from the stored records.

import { crosstabStageStatus, importStageStatus, objectiveStageStatus, plural, sortIssues, stageStateOf, strip, type CrosstabFileFacts, type ImportFileFacts, type ObjectiveStageInput, type StageItem, type StageState, type StageStatus } from "./stageStatus";

export type ModuleState = StageState | "not_used";
export type ModuleStatus = Omit<StageStatus, "state"> & { state: ModuleState };

export type SectionId = "prepare" | "analyse" | "develop" | "deliver";

export const SECTIONS: { id: SectionId; label: string; navId: string; modules: { id: string; label: string }[] }[] = [
  {
    id: "prepare",
    label: "Prepare",
    navId: "overview-prepare",
    modules: [
      { id: "upload", label: "Import data" },
      { id: "research-quality", label: "Research quality" },
      { id: "objective", label: "Objectives" },
      { id: "decisions", label: "Business decisions" },
    ],
  },
  {
    id: "analyse",
    label: "Analyse",
    navId: "overview-analyse",
    modules: [
      { id: "crosstabs", label: "Cross tabs" },
      { id: "analytics", label: "Analytics" },
      { id: "coding", label: "Coding" },
      { id: "reports", label: "Secondary analysis" },
    ],
  },
  {
    id: "develop",
    label: "Develop findings",
    navId: "overview-develop",
    modules: [
      { id: "findings", label: "Findings" },
      { id: "synthesized", label: "Insights" },
    ],
  },
  {
    id: "deliver",
    label: "Deliver",
    navId: "overview-deliver",
    modules: [
      { id: "recommendations", label: "Recommendations" },
      { id: "insights-report", label: "Insights report" },
    ],
  },
];

const status = (items: StageItem[], headline: string, counts: StageStatus["counts"] = []): ModuleStatus => {
  const issues = sortIssues(items.filter((i) => i.state !== "caveat"));
  return { state: stageStateOf(issues), headline, counts, issues: strip(issues), caveats: strip(items.filter((i) => i.state === "caveat")) };
};
const notUsed = (headline: string): ModuleStatus => ({ state: "not_used", headline, counts: [], issues: [], caveats: [] });
const at = (id: string) => ({ kind: "section" as const, id });

// ---------------------------------------------------------------- facts

export type ProjectStageFacts = {
  import: { files: ImportFileFacts[]; tablesReadFailed: boolean };
  objectives: ObjectiveStageInput;
  researchQuality: { latest: "running" | "complete" | "partial" | "failed" | null; hasContextFile: boolean } | { unreadable: true };
  decisions: { pending: number; accepted: number; refreshPending: boolean | null };
  crosstabs: { files: CrosstabFileFacts[]; tablesReadFailed: boolean };
  analytics: { analysisFindings: number };
  coding: { transcripts: { id: string; filename: string; setupAccepted: boolean | null; coded: boolean }[] };
  reports: { reports: { id: string; filename: string; failed: boolean; claims: number }[]; processErrors: string[] };
  findings: {
    total: number;
    pending: number;
    accepted: number;
    rejected: number;
    /** Sources a finding can come from are present (data, transcripts, reports, output). */
    hasSources: boolean;
    /** Inside a project only (evidenceOverview.summarizeFindings). */
    attention?: { contradictions: number; designChanged: number; designUnknown: number; quoteNotFound: number; claimsNotSupported: number };
  };
  insights: {
    total: number;
    inUse: number;
    /** Inside a project only: support of the insights in use. */
    support?: { stale: number; invalid: number; unknown: number };
  };
  recommendations: {
    total: number;
    pending: number;
    accepted: number;
    /** Inside a project only (recommendationOverview.summarizeRecommendations().attention). */
    attention?: { supportInvalid: number; supportStale: number; supportUnknown: number; decisionEarlier: number; decisionUnknown: number; insightsWithoutRecommendation: number };
  };
  report: { generatedAt: string | null; error: string | null };
};

// ---------------------------------------------------------------- module rules

export function researchQualityStatus(f: ProjectStageFacts["researchQuality"]): ModuleStatus {
  if ("unreadable" in f) return status([{ key: "unreadable", state: "couldnt_check", text: "Whether a review has run could not be read.", target: at("research-quality") }], "Could not be checked");
  if (f.latest === null) return notUsed(f.hasContextFile ? "Optional: rate the brief or proposal against good research practice" : "Optional: needs a brief or proposal");
  if (f.latest === "running") return status([{ key: "running", state: "working", text: "A review is running", target: at("research-quality") }], "A review is running");
  if (f.latest === "failed" || f.latest === "partial")
    return status([{ key: f.latest, state: "needs_you", text: f.latest === "failed" ? "The last review failed: open it to retry" : "The last review finished only partly: open it to retry the missing parts", target: at("research-quality") }], f.latest === "failed" ? "The last review failed" : "The last review is partial");
  return status([], "Reviewed");
}

export function decisionsStatus(f: ProjectStageFacts["decisions"]): ModuleStatus {
  const items: StageItem[] = [];
  if (f.pending > 0) items.push({ key: "pending", state: "needs_you", text: `Review ${plural(f.pending, "suggested decision", "suggested decisions")}`, target: at("decisions") });
  if (f.refreshPending === true) items.push({ key: "refresh", state: "needs_you", text: "The decisions changed: refresh the insights and recommendations that depend on them", target: at("decisions") });
  if (f.refreshPending === null) items.push({ key: "refresh-unknown", state: "couldnt_check", text: "Whether work depending on the decisions needs refreshing could not be read", target: at("decisions") });
  if (f.accepted === 0 && f.pending === 0) items.push({ key: "none", state: "needs_you", text: "Add the business decision this research informs", target: at("decisions") });
  return status(items, f.accepted > 0 && items.length === 0 ? `${plural(f.accepted, "decision", "decisions")} set` : f.accepted === 0 ? "No decision set yet" : "Decisions need you");
}

export function analyticsStatus(f: ProjectStageFacts["analytics"]): ModuleStatus {
  return f.analysisFindings > 0 ? status([], `${plural(f.analysisFindings, "analysis finding", "analysis findings")} posted`) : notUsed("Optional: drivers, NPS, charts and more on a data file");
}

export function codingStatus(f: ProjectStageFacts["coding"]): ModuleStatus {
  if (f.transcripts.length === 0) return notUsed("No transcripts imported");
  const items: StageItem[] = [];
  for (const t of f.transcripts) {
    if (t.setupAccepted === false) items.push({ key: `${t.id}:setup`, state: "needs_you", text: `Accept the setup of ${t.filename}`, target: { kind: "import_file", documentId: t.id, tab: "setup" } });
    else if (t.setupAccepted === null) items.push({ key: `${t.id}:setup-unknown`, state: "couldnt_check", text: `Whether the setup of ${t.filename} is accepted could not be read`, target: { kind: "import_file", documentId: t.id, tab: "setup" } });
    else if (!t.coded) items.push({ key: `${t.id}:code`, state: "needs_you", text: `Code ${t.filename}`, target: at("coding") });
  }
  const coded = f.transcripts.filter((t) => t.coded).length;
  return status(items, items.length === 0 ? `${plural(coded, "transcript", "transcripts")} coded` : `${coded} of ${plural(f.transcripts.length, "transcript", "transcripts")} coded`);
}

export function reportsStatus(f: ProjectStageFacts["reports"]): ModuleStatus {
  if (f.reports.length === 0) return notUsed("No reports imported");
  const items: StageItem[] = [];
  for (const r of f.reports) {
    if (r.failed) items.push({ key: `${r.id}:failed`, state: "needs_you", text: `${r.filename} could not be read`, target: { kind: "import_file", documentId: r.id, tab: "preview" } });
    else if (r.claims === 0) items.push({ key: `${r.id}:read`, state: "needs_you", text: `Read the claims in ${r.filename}`, target: at("reports") });
  }
  for (const [i, e] of f.processErrors.entries()) items.push({ key: `error:${i}`, state: "needs_you", text: `The last processing reported: ${e.replace(/\.$/, "")}`, target: at("reports") });
  const claims = f.reports.reduce((n, r) => n + r.claims, 0);
  return status(items, items.length === 0 ? `${plural(f.reports.length, "report", "reports")} read, ${plural(claims, "claim", "claims")}` : "Reports need you");
}

export function findingsStatus(f: ProjectStageFacts["findings"]): ModuleStatus {
  const items: StageItem[] = [];
  if (f.total === 0)
    items.push({ key: "none", state: "needs_you", text: f.hasSources ? "No findings yet: commit cross tabs, code transcripts or read a report" : "Add data, transcripts or a report under Import data first", target: at(f.hasSources ? "findings" : "upload") });
  if (f.pending > 0) items.push({ key: "pending", state: "needs_you", text: `Review ${plural(f.pending, "finding", "findings")} waiting`, target: at("findings") });
  const a = f.attention;
  if (a) {
    if (a.designChanged > 0) items.push({ key: "design-changed", state: "needs_you", text: `${plural(a.designChanged, "finding was", "findings were")} built before the survey design changed: check ${a.designChanged === 1 ? "it" : "them"}`, target: at("findings") });
    if (a.designUnknown > 0) items.push({ key: "design-unknown", state: "couldnt_check", text: `Whether the survey design behind ${plural(a.designUnknown, "finding", "findings")} changed could not be checked`, target: at("findings") });
    if (a.contradictions > 0) items.push({ key: "contradictions", state: "caveat", text: `${plural(a.contradictions, "finding contradicts", "findings contradict")} the report or other evidence`, target: at("findings") });
    if (a.quoteNotFound > 0) items.push({ key: "quotes", state: "caveat", text: `${plural(a.quoteNotFound, "report claim's quote was", "report claims' quotes were")} not found in the report`, target: at("findings") });
    if (a.claimsNotSupported > 0) items.push({ key: "claims", state: "caveat", text: `${plural(a.claimsNotSupported, "report claim is", "report claims are")} not supported by the data`, target: at("findings") });
  }
  return status(items, f.total === 0 ? "No findings yet" : f.pending > 0 ? `${f.pending} of ${plural(f.total, "finding", "findings")} to review` : `${plural(f.total, "finding", "findings")} reviewed: ${f.accepted} accepted, ${f.rejected} excluded`);
}

export function insightsStatus(f: ProjectStageFacts["insights"], acceptedFindings: number): ModuleStatus {
  const items: StageItem[] = [];
  if (f.total === 0) items.push({ key: "none", state: "needs_you", text: acceptedFindings > 0 ? `Generate insights from ${plural(acceptedFindings, "accepted finding", "accepted findings")}` : "Accept findings first", target: at(acceptedFindings > 0 ? "synthesized" : "findings") });
  const s = f.support;
  if (s) {
    if (s.invalid > 0) items.push({ key: "invalid", state: "needs_you", text: `${plural(s.invalid, "insight no longer has", "insights no longer have")} valid support`, target: at("synthesized") });
    if (s.stale > 0) items.push({ key: "stale", state: "needs_you", text: `The support of ${plural(s.stale, "insight", "insights")} changed since ${s.stale === 1 ? "it was" : "they were"} written`, target: at("synthesized") });
    if (s.unknown > 0) items.push({ key: "unknown", state: "couldnt_check", text: `The support of ${plural(s.unknown, "insight", "insights")} could not be checked`, target: at("synthesized") });
  }
  return status(items, f.total === 0 ? "No insights yet" : `${plural(f.inUse, "insight", "insights")} in use`);
}

export function recommendationsStatus(f: ProjectStageFacts["recommendations"], insightsInUse: number): ModuleStatus {
  const items: StageItem[] = [];
  if (f.total === 0) items.push({ key: "none", state: "needs_you", text: insightsInUse > 0 ? "Generate recommendations from the insights in use" : "Insights come first", target: at(insightsInUse > 0 ? "recommendations" : "synthesized") });
  if (f.pending > 0) items.push({ key: "pending", state: "needs_you", text: `Review ${plural(f.pending, "recommendation", "recommendations")} waiting`, target: at("recommendations") });
  const a = f.attention;
  if (a) {
    if (a.supportInvalid > 0) items.push({ key: "invalid", state: "needs_you", text: `${plural(a.supportInvalid, "recommendation rests", "recommendations rest")} on support that is no longer valid`, target: at("recommendations") });
    if (a.supportStale > 0) items.push({ key: "stale", state: "needs_you", text: `The support of ${plural(a.supportStale, "recommendation", "recommendations")} changed`, target: at("recommendations") });
    if (a.supportUnknown > 0) items.push({ key: "unknown", state: "couldnt_check", text: `The support of ${plural(a.supportUnknown, "recommendation", "recommendations")} could not be checked`, target: at("recommendations") });
    if (a.insightsWithoutRecommendation > 0) items.push({ key: "missing", state: "needs_you", text: `${plural(a.insightsWithoutRecommendation, "accepted insight has", "accepted insights have")} no recommendation; the last generation may not have finished`, target: at("recommendations") });
    if (a.decisionEarlier > 0) items.push({ key: "earlier", state: "caveat", text: `${plural(a.decisionEarlier, "recommendation was", "recommendations were")} written for earlier decisions`, target: at("recommendations") });
    if (a.decisionUnknown > 0) items.push({ key: "decision-unknown", state: "caveat", text: `For ${plural(a.decisionUnknown, "recommendation", "recommendations")} the decisions behind ${a.decisionUnknown === 1 ? "it were" : "them were"} not recorded`, target: at("recommendations") });
  }
  return status(items, f.total === 0 ? "No recommendations yet" : `${plural(f.accepted, "recommendation", "recommendations")} accepted`);
}

export function reportStatus(f: ProjectStageFacts["report"], ready: { insightsInUse: number; acceptedRecommendations: number }): ModuleStatus {
  const items: StageItem[] = [];
  if (f.generatedAt === null) {
    if (f.error) items.push({ key: "error", state: "needs_you", text: `The last generation failed: ${f.error.replace(/\.$/, "")}`, target: at("insights-report") });
    items.push({
      key: "none",
      state: "needs_you",
      text: ready.insightsInUse > 0 ? "Generate the insights report" : "Insights and recommendations come first",
      target: at(ready.insightsInUse > 0 ? "insights-report" : "synthesized"),
    });
  }
  return status(items, f.generatedAt === null ? "No report yet" : `Report generated ${f.generatedAt.slice(0, 10)}`);
}

// ---------------------------------------------------------------- sections

export type SectionModule = { id: string; label: string; status: ModuleStatus };
export type SectionStatus = { id: SectionId; label: string; navId: string; state: ModuleState; headline: string; modules: SectionModule[] };

export function moduleStatuses(f: ProjectStageFacts): Record<string, ModuleStatus> {
  const insightsInUse = f.insights.inUse;
  return {
    upload: importStageStatus(f.import),
    "research-quality": researchQualityStatus(f.researchQuality),
    objective: objectiveStageStatus(f.objectives),
    decisions: decisionsStatus(f.decisions),
    crosstabs: crosstabStageStatus(f.crosstabs),
    analytics: analyticsStatus(f.analytics),
    coding: codingStatus(f.coding),
    reports: reportsStatus(f.reports),
    findings: findingsStatus(f.findings),
    synthesized: insightsStatus(f.insights, f.findings.accepted),
    recommendations: recommendationsStatus(f.recommendations, insightsInUse),
    "insights-report": reportStatus(f.report, { insightsInUse, acceptedRecommendations: f.recommendations.accepted }),
  };
}

/**
 * A section's state is the worst of its modules in use; a section whose modules are all unused is
 * Not used. Cross tabs counts as not used when the project has no data file to open (its own rule
 * still says so), so a qualitative-only project's Analyse section is judged by Coding.
 */
export function sectionStatuses(f: ProjectStageFacts): SectionStatus[] {
  const all = moduleStatuses(f);
  const noDataFile = f.crosstabs.files.filter((x) => x.state !== "aggregated").length === 0;
  return SECTIONS.map((s) => {
    const modules = s.modules.map((m) => {
      const st = all[m.id];
      return { ...m, status: m.id === "crosstabs" && noDataFile && f.coding.transcripts.length + f.reports.reports.length > 0 ? { ...st, state: "not_used" as const } : st };
    });
    const used = modules.filter((m) => m.status.state !== "not_used");
    const rank: ModuleState[] = ["couldnt_check", "needs_you", "working", "ready"];
    const state: ModuleState = used.length === 0 ? "not_used" : rank.find((r) => used.some((m) => m.status.state === r)) ?? "ready";
    const waiting = used.filter((m) => m.status.state === "needs_you" || m.status.state === "couldnt_check").map((m) => m.label);
    const headline =
      state === "not_used"
        ? "Nothing here yet"
        : state === "ready"
          ? "All done"
          : state === "working"
            ? "Working"
            : `${waiting.join(", ")} ${waiting.length === 1 ? "needs" : "need"} you`;
    return { id: s.id, label: s.label, navId: s.navId, state, headline, modules };
  });
}

/** The project's next step: the first module, in workflow order, that needs the researcher. */
export function nextStep(sections: SectionStatus[]): { section: SectionId; moduleId: string; label: string; text: string } | null {
  for (const s of sections)
    for (const m of s.modules) {
      const first = m.status.issues.find((i) => i.state === "needs_you" || i.state === "couldnt_check");
      if (first) return { section: s.id, moduleId: m.id, label: m.label, text: first.text };
    }
  return null;
}
