import type { UaField, UaRecognition } from "./uaTypes";
import { clean } from "./uaRouting";

export const UA_ROLE_RULES = "ua-2026-10-30-1";
const meaning = (f: UaField) => clean(f.label);
export const isUaResponse = (f: UaField) => /survey response|coded open response|stored none/i.test(f.meta.fieldRole ?? "") && !!f.meta.stateVariable;
const RULES: Record<string, (f: UaField) => boolean> = {
  everConsumption: f => /ever personally drunk/.test(meaning(f)),
  consumptionRecency: f => /most recent personal consumption$/.test(meaning(f)),
  purchaseP3m: f => /personally paid for.*past three calendar months/.test(meaning(f)),
  occasionsP3m: f => /number of personal use occasions in p3m/.test(meaning(f)),
  consumptionLitresP3m: f => /total litres personally drunk in p3m/.test(meaning(f)),
  tripsP3m: f => /number of personal purchase occasions in p3m/.test(meaning(f)),
  purchaseLitresP3m: f => /total litres personally paid for in p3m/.test(meaning(f)),
  spendP3m: f => /total personal.*spend in p3m/.test(meaning(f)),
  postponed: f => /specific.*purchase.*postpon|specific.*postpon.*purchase|postponed specific purchase/.test(meaning(f)),
  postponedStatus: f => /current status of postponed purchase/.test(meaning(f)),
  useIntent: f => /next-three-month personal use intention/.test(meaning(f)),
  purchaseIntent: f => /next-three-month personal purchase intention/.test(meaning(f)),
  firstChoice: f => /stated first-choice brand/.test(meaning(f)),
  topMind: f => /spontaneous brand mention 1, coded/.test(meaning(f)),
  lastSugar: f => /sugar variant consumed on most recent episode/.test(meaning(f)),
  previousPurchase: f => /has a purchase occasion before most recent purchase/.test(meaning(f)),
};

/** The U&A signature needs independent category usage/purchase questions with declared states and breadth.
 * Numeric spend and frequency are optional: an absent area must not hide the rest of a U&A study. */
export function recogniseUa(fields: UaField[], corrections: Record<string, string | null> = {}): UaRecognition {
  const questions: UaRecognition["questions"] = []; const roles: UaRecognition["roles"] = {}; const reasons: string[] = [];
  for (const [role, rule] of Object.entries(RULES)) {
    const candidates = fields.filter(f => isUaResponse(f) && rule(f));
    if (Object.hasOwn(corrections, role)) {
      const chosen = corrections[role];
      if (chosen === null || fields.some(f => isUaResponse(f) && f.variable === chosen)) roles[role] = chosen;
      else { roles[role] = null; questions.push({ role, reason: "The saved variable is not available in this wave; its choice is retained.", candidates: candidates.map(f => f.variable) }); }
    } else if (candidates.length === 1) {
      roles[role] = candidates[0].variable; reasons.push(`${role}: ${candidates[0].questionId ?? "question ID unavailable"}, ${candidates[0].label}; confirmed wording, route and response-state field.`);
    } else {
      roles[role] = null; questions.push({ role, reason: candidates.length ? "More than one confirmed question has this meaning. Choose one." : "Not asked or not yet confirmed from the codebook.", candidates: candidates.map(f => f.variable) });
    }
  }
  const first = fields.find(f => f.variable === roles.firstChoice);
  const brands = first?.options.filter(o => !/none|no first|no brand|no preference|would not choose|not know|unbranded/i.test(o.label)) ?? [];
  const analysis = fields.filter(f => /analysis weight/i.test(f.label) && !/expansion/i.test(f.label));
  const population = fields.filter(f => /expansion weight/i.test(f.label) && /hypothetical|fictional|invented/i.test(f.label));
  const core = ["everConsumption", "consumptionRecency", "purchaseP3m"];
  const breadth = fields.some(f => /agree or disagree/i.test(f.meta.questionWording ?? "")) || fields.some(f => /most recent.*occasion|most recent.*episode/i.test(f.label));
  const certain = core.filter(k => roles[k]).length;
  const possible = core.filter(k => roles[k] || questions.some(q => q.role === k && q.candidates.length)).length;
  return { recognised: certain >= 2 && breadth, needsMapping: certain < 2 && possible >= 2 && breadth, fields, reasons, questions, brands, roles, analysisWeight: analysis.length === 1 ? analysis[0].variable : null, populationWeight: population.length === 1 ? population[0].variable : null };
}

export const UA_ROLES = Object.keys(RULES);
