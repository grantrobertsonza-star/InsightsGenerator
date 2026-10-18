// Research Quality Review: the quantitative checklist (RQK-1), added 2026-10-18 at Grant's request.
//
// Each document type has a fixed list of required elements, drawn from research-methods practice
// (src/research-quality/checklists/RQK-1.json). The model's only job is to say, for each element,
// whether the document states it (present / partial / absent) and to cite the facts that show it;
// those facts were extracted earlier with exact quotes that code located in the document text.
// Everything numeric is computed here, by code, from those statuses:
//   element points: present 2, partial 1, absent 0;
//   section and overall percentage: points / (2 x elements assessed), over assessed elements only;
//   band: Strong >= 80%, Workable >= 60%, Weak below (the objective scorer's 16/20 and 12/20).
// An element is "not assessed", and left out of every percentage, when its status cannot be relied
// on: the model omitted it, claimed presence without citing a fact from that document, claimed
// absence while citing facts, or claimed absence in a document that was not read in full. Unknown is
// never scored as absent. Scores are a guide to where to look, not a certification.
// Pure module: no database, no model calls.
import checklistRelease from "../research-quality/checklists/RQK-1.json";
import { canonicalJson, sha256 } from "./researchQualityRules";
import type { DocumentedFact, SourceRole } from "./researchQualityTypes";

export type ChecklistElement = {
  elementId: string;
  label: string;
  present: string;
  partial: string;
  recommendation: string;
  essential: boolean;
  compare?: string;
  rule?: string;
};
export type ChecklistSection = { sectionId: string; label: string; elements: ChecklistElement[] };
export type Checklist = { checklistId: string; label: string; roles: string[]; basis: string; sections: ChecklistSection[] };

export const CHECKLISTS = {
  release: checklistRelease.release,
  hash: sha256(canonicalJson(checklistRelease)),
  checklists: checklistRelease.checklists as Checklist[],
};

export type ElementStatus = "present" | "partial" | "absent" | "not_assessed";
export type Band = "strong" | "workable" | "weak";
export const ELEMENT_POINTS: Record<Exclude<ElementStatus, "not_assessed">, number> = { present: 2, partial: 1, absent: 0 };

/** The band for a percentage, using the release's thresholds. */
export function bandFor(pct: number): Band {
  for (const b of checklistRelease.bands) if (pct >= b.minPct) return b.band as Band;
  return "weak";
}

/**
 * The checklists that apply to one source, from the roles the researcher confirmed. A document with
 * several roles gets each matching checklist once; a role with no checklist (discussion guide) gets
 * none, which the screen states rather than scoring the document against the wrong list.
 */
export function checklistsForRoles(roles: readonly SourceRole[]): Checklist[] {
  return CHECKLISTS.checklists.filter((c) => c.roles.some((r) => roles.includes(r as SourceRole)));
}

export function findChecklist(checklistId: string): Checklist | null {
  return CHECKLISTS.checklists.find((c) => c.checklistId === checklistId) ?? null;
}

export type ElementResult = {
  elementId: string;
  status: ElementStatus;
  factIds: string[];
  reason: string;
  /** Why code did not accept the model's status, when it did not. */
  notAssessedBecause: string | null;
};

type RawElement = { element_id?: unknown; status?: unknown; fact_ids?: unknown; reason?: unknown };

/**
 * Validates one checklist answer for one document. `ownFacts` are the facts extracted from that
 * document; `briefFacts` are a selected brief's facts, citable only by elements compared with the
 * brief. `fullyRead` is false when part of the document was not read (too long, or an extraction
 * step failed), in which case "absent" cannot be told apart from "not read".
 */
export function validateChecklistAnswer(
  raw: unknown,
  checklist: Checklist,
  ctx: { ownFacts: DocumentedFact[]; briefFacts: DocumentedFact[]; fullyRead: boolean },
): ElementResult[] {
  const list = (raw as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(list)) throw new Error("the checklist answer is not in the required shape (elements: " + (list === undefined ? "missing" : typeof list) + ")");
  const byId = new Map<string, RawElement>();
  for (const e of list as RawElement[]) {
    const id = typeof e?.element_id === "string" ? e.element_id : null;
    if (id && !byId.has(id)) byId.set(id, e); // first answer per element wins; unknown ids are ignored
  }
  const own = new Map(ctx.ownFacts.map((f) => [f.factId, f]));
  const brief = new Map(ctx.briefFacts.map((f) => [f.factId, f]));
  const out: ElementResult[] = [];
  for (const section of checklist.sections) {
    for (const el of section.elements) {
      const e = byId.get(el.elementId);
      const notAssessed = (because: string, reason = ""): ElementResult => ({ elementId: el.elementId, status: "not_assessed", factIds: [], reason, notAssessedBecause: because });
      if (!e) {
        out.push(notAssessed("the model did not give a status for this element"));
        continue;
      }
      const status = e.status;
      const reason = typeof e.reason === "string" ? e.reason.trim().slice(0, 600) : "";
      const citable = (id: string) => own.has(id) || (el.compare === "brief_if_present" && brief.has(id));
      const cited = Array.isArray(e.fact_ids) ? [...new Set((e.fact_ids as unknown[]).filter((x): x is string => typeof x === "string" && citable(x)))] : [];
      const ownCited = cited.filter((id) => own.has(id));
      if (status === "present" || status === "partial") {
        // Presence must rest on this document's own quoted text; a brief fact alone shows what the
        // brief asked for, not what this document says.
        if (ownCited.length === 0) {
          out.push(notAssessed("marked as stated, but no quoted fact from this document was cited", reason));
          continue;
        }
        let finalStatus: ElementStatus = status;
        const min = /^min-objective-facts:(\d+)$/.exec(el.rule ?? "");
        if (min) {
          // Counted by code: distinct cited facts that the extractor labelled as objectives.
          const n = ownCited.filter((id) => own.get(id)!.topic === "objective").length;
          // Fewer than the minimum caps the element at partial, whatever the model said.
          finalStatus = n >= Number(min[1]) ? status : "partial";
        }
        out.push({ elementId: el.elementId, status: finalStatus, factIds: cited, reason, notAssessedBecause: null });
        continue;
      }
      if (status === "absent") {
        if (ownCited.length > 0) {
          out.push(notAssessed("marked as absent while citing facts from this document", reason));
          continue;
        }
        if (!ctx.fullyRead) {
          out.push(notAssessed("not all of the document was read, so absence cannot be confirmed", reason));
          continue;
        }
        out.push({ elementId: el.elementId, status: "absent", factIds: cited, reason, notAssessedBecause: null });
        continue;
      }
      out.push(notAssessed("the model gave a status that is not present, partial or absent", reason));
    }
  }
  return out;
}

export type SectionScore = { sectionId: string; label: string; points: number; possible: number; pct: number | null; band: Band | null; assessed: number; total: number };
export type ChecklistScore = { points: number; possible: number; pct: number | null; band: Band | null; assessed: number; total: number; sections: SectionScore[] };

/** Below this share of elements assessed, no overall percentage is given: too little is known. */
export const MIN_ASSESSED_SHARE = 0.5;

function pctOf(points: number, possible: number): number | null {
  return possible === 0 ? null : Math.round((points / possible) * 100);
}

/**
 * Section and overall scores for one checklist. Percentages count assessed elements only; the
 * overall percentage is computed from all assessed elements (not an average of sections, which would
 * weight a two-element section like an eight-element one). With fewer than MIN_ASSESSED_SHARE of the
 * elements assessed, the overall percentage and band are withheld.
 */
export function scoreChecklist(checklist: Checklist, results: ElementResult[]): ChecklistScore {
  const byId = new Map(results.map((r) => [r.elementId, r]));
  let points = 0;
  let assessed = 0;
  let total = 0;
  const sections: SectionScore[] = checklist.sections.map((s) => {
    let sp = 0;
    let sa = 0;
    for (const el of s.elements) {
      const r = byId.get(el.elementId);
      if (!r || r.status === "not_assessed") continue;
      sp += ELEMENT_POINTS[r.status];
      sa++;
    }
    points += sp;
    assessed += sa;
    total += s.elements.length;
    const pct = pctOf(sp, sa * 2);
    return { sectionId: s.sectionId, label: s.label, points: sp, possible: sa * 2, pct, band: pct === null ? null : bandFor(pct), assessed: sa, total: s.elements.length };
  });
  const enough = total > 0 && assessed / total >= MIN_ASSESSED_SHARE;
  const pct = enough ? pctOf(points, assessed * 2) : null;
  return { points, possible: assessed * 2, pct, band: pct === null ? null : bandFor(pct), assessed, total, sections };
}

export type GapRecommendation = { checklistId: string; elementId: string; label: string; sectionLabel: string; status: "partial" | "absent"; essential: boolean; recommendation: string };

/**
 * The checklist's own recommendation for every partial or absent element, essential elements first,
 * then in checklist order. Not-assessed elements get none: nothing is known to be missing.
 */
export function gapRecommendations(checklist: Checklist, results: ElementResult[]): GapRecommendation[] {
  const byId = new Map(results.map((r) => [r.elementId, r]));
  const out: GapRecommendation[] = [];
  for (const s of checklist.sections)
    for (const el of s.elements) {
      const r = byId.get(el.elementId);
      if (r && (r.status === "partial" || r.status === "absent"))
        out.push({ checklistId: checklist.checklistId, elementId: el.elementId, label: el.label, sectionLabel: s.label, status: r.status, essential: el.essential, recommendation: el.recommendation });
    }
  return out.sort((a, b) => Number(b.essential) - Number(a.essential));
}
