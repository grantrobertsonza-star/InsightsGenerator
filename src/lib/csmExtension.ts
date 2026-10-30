// R6 CSM extension (Grant, 30 October 2026): the CSM dashboard's added sections for one wave, computed without
// saving anything. The contract is claude/csm-extension.md; the pieces:
//   csmExtensionKeys.ts   the wave's Relationship, Channel and Noncustomer files, read and their keys checked
//   csmExtensionRoles.ts  each file's grain and sample type, and the fields each construct needs
//   csmExtensionMetrics.ts the statistic definitions read from the engine's tables (computeCrosstab)
//   csmJourney.ts         Journey continuity and the customer benchmark (Relationship file)
//   csmExperience.ts      emotions, preference and reasons for staying (Relationship and Channel files)
//   csmNoncustomer.ts     the focal-noncustomer profile (Noncustomer file)
// Weighting: current customers use the dashboard's choice (weighted by default when the file has a weight, D2) with
// each file's own weight variable (channel records inherit their customer's weight); noncustomers are unit weight.
// A file whose keys fail its checks, or that cannot be linked to the wave's customers, is not used and says why.
import { loadTrackerDashboard } from "./trackerDashboards";
import { GRAIN_TEXT, SAMPLE_TYPE_TEXT, relationshipFields, type CsmGrain, type CsmSampleType } from "./csmExtensionRoles";
import { loadCsmWaveFiles, type CsmFile } from "./csmExtensionKeys";
import { journeyPopulation, loadBenchmark, loadJourneySection, type Benchmark, type JourneyFilters, type JourneySection } from "./csmJourney";
import { loadExperienceSection, type ExperienceSection } from "./csmExperience";
import { loadNoncustomerSection, type NoncustomerSection } from "./csmNoncustomer";

export const CSM_EXTENSION_SECTIONS = ["journey", "experience", "competitive"] as const;
export type CsmExtensionSectionId = (typeof CSM_EXTENSION_SECTIONS)[number];

export type CsmExtensionFilters = JourneyFilters;

export type FileSummary = { grain: CsmGrain; grainText: string; sampleType: CsmSampleType; sampleTypeText: string; documentId: string; filename: string; sheetName: string | null; evidence: string; records: number | null; distinctPeople: number | null; keysChecked: boolean; keyProblems: string[]; used: boolean; reason?: string };

export type CsmExtensionView = {
  wave: string | null;
  openGrain: CsmGrain | null;
  openReason: string | null;
  weighted: boolean;
  files: FileSummary[];
  absent: Partial<Record<CsmGrain, string>>;
  linkProblems: string[];
  notUsed: string[];
  channelNames: { code: string; label: string }[];
  /** The task and journey channel filters' options (the Relationship file's answer lists), for every section. */
  options: { tasks: { code: string; label: string }[]; journeyChannels: { code: string; label: string }[] };
  filters: CsmExtensionFilters;
  section: CsmExtensionSectionId;
  journey?: JourneySection | { status: "not_measured"; reason: string };
  experience?: ExperienceSection;
  competitive?: { benchmark: Benchmark | { status: "not_measured"; reason: string }; noncustomer: NoncustomerSection };
};

const CODE = /^-?\d{1,6}$/;
/** The section and filters as a screen sent them, checked at the server boundary (codes are numeric answer codes;
 * whether each is in its answer list is checked against the file when the population is built). */
export function parseExtensionRequest(raw: unknown): { ok: true; section: CsmExtensionSectionId; filters: CsmExtensionFilters } | { ok: false; error: string } {
  const bad = { ok: false as const, error: "The section or its filters were not understood. Choose them again." };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad;
  const r = raw as Record<string, unknown>;
  if (!CSM_EXTENSION_SECTIONS.includes(r.section as CsmExtensionSectionId)) return bad;
  const code = (v: unknown): string | null | undefined => (v === null || v === undefined || v === "" ? null : typeof v === "string" && CODE.test(v) ? v : undefined);
  const filters = { company: code(r.company), task: code(r.task), journeyChannel: code(r.journeyChannel) };
  if (Object.values(filters).some((v) => v === undefined)) return bad;
  return { ok: true, section: r.section as CsmExtensionSectionId, filters: filters as CsmExtensionFilters };
}

/** A channel's name: the Channel file's answer list, else the Relationship file's journey channel wording. */
function channelNamesOf(relationship: CsmFile | null, channel: CsmFile | null): { code: string; label: string }[] {
  const fromChannel = channel?.variables.find((v) => v.name === "channel")?.valueLabels;
  if (fromChannel && Object.keys(fromChannel).length) return Object.entries(fromChannel).map(([code, label]) => ({ code, label }));
  const out: { code: string; label: string }[] = [];
  for (const c of ["1", "2", "3", "4"]) {
    const v = relationship?.variables.find((x) => x.name === `journey_channel_c0${c}`);
    if (v) out.push({ code: c, label: v.label.replace(/^same task used\s+/i, "") || `Channel ${c}` });
  }
  return out;
}

export async function loadCsmExtension(tenantId: string, runId: string, documentId: string, section: CsmExtensionSectionId, filters: CsmExtensionFilters): Promise<CsmExtensionView> {
  // In turn, not together: the engine keeps two files read at a time (see loadCsmWaveFiles).
  const view = await loadTrackerDashboard(tenantId, runId, documentId);
  const wave = await loadCsmWaveFiles(tenantId, runId, documentId);
  const weighted = view.dashboard.weighted;
  const weighting = (f: CsmFile) => (weighted ? f.weightVar : null);

  // A grain is used only when its keys hold; Channel and Noncustomer only when they link to this wave's customers.
  const usable = (f: CsmFile | null, link: boolean): { file: CsmFile | null; reason?: string } => {
    if (!f) return { file: null };
    if (!f.keys.ok) return { file: null, reason: `${f.filename} is not used: ${f.keys.problems.join(" ")}` };
    if (link && wave.linkProblems.length) return { file: null, reason: `${f.filename} is not used because the wave's files do not link: ${wave.linkProblems.join(" ")}` };
    return { file: f };
  };
  const rel = usable(wave.relationship, false);
  const ch = usable(wave.channel, true);
  const nc = usable(wave.noncustomer, true);
  const absentOf = (g: CsmGrain, u: { reason?: string }) => u.reason ?? wave.absent[g];
  const files: FileSummary[] = [
    [wave.relationship, rel],
    [wave.channel, ch],
    [wave.noncustomer, nc],
  ]
    .filter((x): x is [CsmFile, { file: CsmFile | null; reason?: string }] => x[0] !== null)
    .map(([f, u]) => ({ grain: f.grain, grainText: GRAIN_TEXT[f.grain], sampleType: f.sampleType, sampleTypeText: SAMPLE_TYPE_TEXT[f.sampleType], documentId: f.documentId, filename: f.filename, sheetName: f.sheetName, evidence: f.grainEvidence, records: f.keys.records, distinctPeople: f.keys.distinctPeople, keysChecked: f.keys.checked, keyProblems: f.keys.problems, used: u.file !== null, ...(u.reason ? { reason: u.reason } : {}) }));
  const channelNames = channelNamesOf(rel.file, ch.file);
  const channelName = (code: string) => channelNames.find((c) => c.code === code)?.label ?? `Channel ${code}`;

  const rf = rel.file ? relationshipFields(rel.file.variables) : null;
  const options = {
    tasks: rf && rf.task.status === "found" ? rf.task.answers : [],
    journeyChannels: rf ? rf.journeyChannels.flatMap((x, i) => (x.status === "found" ? [{ code: String(i + 1), label: channelName(String(i + 1)) }] : [])) : [],
  };
  const out: CsmExtensionView = { options, wave: wave.wave, openGrain: wave.open.grain, openReason: wave.open.reason ?? null, weighted, files, absent: wave.absent, linkProblems: wave.linkProblems, notUsed: wave.notUsed, channelNames, filters, section };
  const relReason = absentOf("relationship", rel) ?? "No Relationship file is linked to this wave.";
  if (section === "journey") {
    out.journey = rel.file ? await loadJourneySection(tenantId, runId, rel.file, weighting(rel.file), filters, channelName) : { status: "not_measured", reason: relReason };
  } else if (section === "experience") {
    const pop = rel.file ? journeyPopulation(rel.file, filters, channelName) : { journeyFilters: [], text: "", select: () => false };
    out.experience = await loadExperienceSection(
      tenantId,
      runId,
      rel.file,
      ch.file,
      weighting,
      { company: filters.company, journeyFilters: pop.journeyFilters, populationText: pop.text, select: pop.select },
      { company: filters.company, channelName },
      { relationship: relReason, channel: absentOf("channel", ch) },
    );
  } else {
    const benchmark = rel.file ? await loadBenchmark(tenantId, runId, rel.file, weighting(rel.file), journeyPopulation(rel.file, { ...filters, journeyChannel: null }, channelName).journeyFilters, channelName) : { status: "not_measured" as const, reason: relReason };
    const noncustomer = await loadNoncustomerSection(tenantId, runId, nc.file, rel.file, rel.file ? weighting(rel.file) : null, absentOf("noncustomer", nc));
    out.competitive = { benchmark, noncustomer };
  }
  return out;
}
