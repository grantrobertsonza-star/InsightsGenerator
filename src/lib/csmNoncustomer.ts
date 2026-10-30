// R6 CSM extension: the focal-noncustomer profile, from the wave's Noncustomer file only (claude/csm-extension.md,
// "Noncustomer profile").
//   - The sample is enforced, not trusted: current_focal_use = 0 and focal_company = the one focal code the file
//     carries (1 in both packs: FNB, Vodacom); records outside are left out and counted. The file must carry one
//     focal code; two are refused.
//   - Unit weight (weight 1, the supplement's design): figures are unweighted, so the raw and weighted bases are equal.
//   - Shown: focal awareness (1 among valid 0 and 1), consideration gated on awareness (top two of 5 among the aware),
//     expected future performance on the six company aspects (mean of 5, aware only), their importance (mean of 5,
//     all), the preferred future channel, and the alternative provider's satisfaction only for a personally
//     experienced recent task (alternative_recent30 = 1, task and channel given, 0 to 30 days).
//   - Never shown for noncustomers: focal satisfaction, NPS, experienced performance or emotions. Expectations are a
//     prospective profile; customers' ratings are retrospective. The customer profile beside it is a separate
//     population and period, so no gap, change or ranking is computed. Nothing is pooled with the customer sample.
import { found, noncustomerFields, relationshipFields } from "./csmExtensionRoles";
import type { CsmFile } from "./csmExtensionKeys";
import { codeFilter, distributionOf, figureOf, rangeFilter, tableOrReason, tabulate, type CsmDistribution, type CsmFigure } from "./csmExtensionMetrics";

export type AttributeRow = { code: string; label: string; expected: CsmFigure; importance: CsmFigure; customerPerformance: CsmFigure };

export type NoncustomerSection =
  | {
      status: "ok";
      filename: string;
      focal: { code: string; label: string };
      records: { inFile: number; inSample: number; leftOut: number };
      awareness: CsmFigure;
      consider: CsmFigure;
      preferredChannel: CsmDistribution;
      attributes: AttributeRow[];
      alternative: CsmFigure;
      alternativeAsked: { recent: number; notRecent: number } | null;
      customerProfile: { status: "ok"; filename: string; text: string } | { status: "not_measured"; reason: string };
    }
  | { status: "not_measured"; reason: string };

/** The six aspects' label from the customers' own performance item when linked, else the noncustomer item's. */
function aspectLabel(customerLabel: string | null, expectLabel: string): string {
  if (customerLabel) return customerLabel;
  return expectLabel.replace(/^expected focal performance\s+/i, "");
}

export async function loadNoncustomerSection(tenantId: string, runId: string, file: CsmFile | null, relationship: CsmFile | null, customerWeight: string | null, absent: string | undefined): Promise<NoncustomerSection> {
  if (!file) return { status: "not_measured", reason: absent ?? "No Noncustomer file is linked to this wave." };
  const f = noncustomerFields(file.variables);
  for (const req of [f.focalCompany, f.currentFocalUse]) if (req.status !== "found") return { status: "not_measured", reason: req.reason };
  const focalCodes = [...new Set(file.rows.map((r) => r.focal_company).filter((v) => v !== null && v !== undefined).map(String))];
  if (focalCodes.length !== 1) return { status: "not_measured", reason: focalCodes.length === 0 ? "focal_company is blank in every record, so the focal provider is unknown." : `focal_company holds ${focalCodes.length} codes (${focalCodes.join(", ")}); the supplement must be about one focal provider.` };
  const focalCode = focalCodes[0];
  const focalLabel = (f.focalCompany.status === "found" ? f.focalCompany.answers.find((a) => a.code === focalCode)?.label : null) ?? `Company ${focalCode}`;
  const sample = [codeFilter("current_focal_use", 0), codeFilter("focal_company", focalCode)];
  const inSample = file.rows.filter((r) => String(r.current_focal_use) === "0" && String(r.focal_company) === focalCode).length;
  const meta = (id: string, label: string, definition: string) => ({ id, label, definition });
  const vars = [f.awareness, f.consider, f.preferredChannel, ...f.expectLevel, ...f.expectImportance, f.alternativeRecent].map(found).filter((x): x is string => !!x);
  // Unit weight: no weight variable, so every record counts 1.
  const t = await tableOrReason(() => tabulate(tenantId, runId, file.documentId, vars, null, sample), "No record meets current_focal_use = 0 and the focal company");
  const alt =
    [f.alternativeRecent, f.alternativeTask, f.alternativeDays, f.alternativeChannel, f.alternativeCsat].every((x) => x.status === "found")
      ? await tableOrReason(
          () => tabulate(tenantId, runId, file.documentId, ["alternative_csat5"], null, [...sample, codeFilter("alternative_recent30", 1), rangeFilter("alternative_days_ago", 0, 30), rangeFilter("alternative_task", 1, 96), rangeFilter("alternative_channel", 1, 96)]),
          "Not measured: no noncustomer reports a personally experienced task with their provider in the past 30 days",
        )
      : { notMeasured: "The alternative experience questions (alternative_recent30, task, days, channel, satisfaction) are not all in this file." };
  const altRecent = "questions" in t ? t.questions.find((q) => q.key === "alternative_recent30") : undefined;
  const altCounts = altRecent ? altRecent.rows.filter((r) => r.rawCode !== undefined && !r.isBase) : [];

  // The customers' own performance on the same aspects for the focal provider, as a separate profile.
  let customerTable: Awaited<ReturnType<typeof tableOrReason>> = { notMeasured: "No Relationship file is linked to this wave." };
  let customerProfile: Extract<NoncustomerSection, { status: "ok" }>["customerProfile"] = { status: "not_measured", reason: "No Relationship file is linked to this wave." };
  const rf = relationship ? relationshipFields(relationship.variables) : null;
  if (relationship && rf) {
    const cv = rf.drivers.map(found).filter((x): x is string => !!x);
    if (cv.length && rf.company.status === "found" && rf.company.answers.some((a) => a.code === focalCode)) {
      customerTable = await tableOrReason(() => tabulate(tenantId, runId, relationship.documentId, cv, customerWeight, [codeFilter("company", focalCode)]), `No current customer of ${focalLabel}`);
      customerProfile = { status: "ok", filename: relationship.filename, text: `Current customers of ${focalLabel}: performance in the past three months (retrospective), ${customerWeight ? "weighted" : "unweighted"}. A separate population and period from the noncustomers' expectations; no gap is computed.` };
    } else customerProfile = { status: "not_measured", reason: cv.length ? `The Relationship file's company list has no code ${focalCode}.` : "The Relationship file has no company performance ratings." };
  }

  return {
    status: "ok",
    filename: file.filename,
    focal: { code: focalCode, label: focalLabel },
    records: { inFile: file.rows.length, inSample, leftOut: file.rows.length - inSample },
    awareness: figureOf(meta("awareness", `Aware of ${focalLabel}`, "Heard of the focal provider before the interview: 1 among valid 0 and 1 (99 excluded and disclosed), all focal noncustomers."), f.awareness, t, "yes"),
    consider: figureOf(meta("consider", `Would consider ${focalLabel}`, "Probably or Definitely yes (4 or 5) among valid 1 to 5, asked only of those aware. Consideration is not trial or use."), f.consider, t, "t2b"),
    preferredChannel: distributionOf(meta("preferredChannel", "Preferred channel for a future task", "A stated preference, not measured channel use."), f.preferredChannel, t, null),
    attributes: f.expectLevel.map((lvl, i) => {
      const code = `d0${i + 1}`;
      const cust = rf ? rf.drivers[i] : null;
      const label = aspectLabel(cust && cust.status === "found" ? cust.label : null, lvl.status === "found" ? lvl.label : f.expectImportance[i].status === "found" ? (f.expectImportance[i] as { label: string }).label : code);
      return {
        code,
        label,
        expected: figureOf(meta(`expect-${code}`, label, "Expected future performance if they became a customer (1 Very poor to 5 Excellent), mean among valid answers of those aware. An expectation, never a rating of service used."), lvl, t, "mean5"),
        importance: figureOf(meta(`importance-${code}`, label, "Importance when choosing a provider (1 Not important to 5 Extremely important), mean among valid answers, all focal noncustomers."), f.expectImportance[i], t, "mean5"),
        customerPerformance: cust ? figureOf(meta(`perf-${code}`, label, "Current customers' rating of the focal provider (1 Very poor to 5 Excellent), mean among valid answers."), cust, customerTable, "mean5") : { ...meta(`perf-${code}`, label, ""), status: "not_measured", reason: "No Relationship file is linked to this wave." },
      };
    }),
    alternative: figureOf(meta("alternative", "Satisfied with their own provider on a recent task", "Satisfied or Very satisfied (4 or 5) among valid 1 to 5, only for a task personally attempted with their current provider in the past 30 days with the task and channel given. Never about the focal provider."), f.alternativeCsat, alt, "t2b"),
    alternativeAsked: altCounts.length ? { recent: altCounts.find((r) => r.rawCode === "1")?.total.nCell ?? 0, notRecent: altCounts.filter((r) => r.rawCode !== "1").reduce((s, r) => s + (r.total.nCell ?? 0), 0) } : null,
    customerProfile,
  };
}
