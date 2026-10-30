import type { UaCondition, UaField } from "./uaTypes";

export const all = (...terms: (UaCondition | undefined)[]): UaCondition | undefined => {
  const present = terms.filter((x): x is UaCondition => !!x);
  return present.length > 1 ? { op: "all", terms: present } : present[0];
};
export const codes = (variable: string, ...values: (string | number)[]): UaCondition => ({ op: "codes", variable, codes: values.map(String) });
export const clean = (text: string) => text.toLowerCase().replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").trim();
export function answerCodes(field: UaField, pattern: RegExp): string[] {
  return field.options.filter(o => pattern.test(clean(o.label))).map(o => o.code);
}
export function answeredCondition(field: UaField, fields: UaField[]): UaCondition {
  const state = fields.find(f => f.variable === field.meta.stateVariable);
  if (!state) throw new Error(`The response-state field for ${field.label} was not confirmed from its codebook.`);
  const values = answerCodes(state, /^answered$/);
  if (values.length !== 1) throw new Error(`The answered-state code for ${field.label} is ambiguous.`);
  return codes(state.variable, ...values);
}

/** The declared question IDs resolve references; physical column prefixes are never question numbers. */
export function compileUaRoute(field: UaField, fields: UaField[]): { eligible?: UaCondition; assigned?: UaCondition } {
  const route = field.meta.eligibleBase?.trim();
  if (!route) throw new Error(`The eligible population for ${field.label} is not declared.`);
  const parts = route.replace(/; no prior-use or purchase requirement/i, "").split(/\s+and\s+/i);
  const conditions: UaCondition[] = []; const assignments: UaCondition[] = [];
  const question = (qid: string, option?: string): UaField => {
    const found = fields.filter(f => f.questionId?.toUpperCase() === qid.toUpperCase() && !/response-state|stored none/i.test(f.meta.fieldRole ?? "") && !/verbatim/i.test(f.label));
    if (option) {
      const candidates = found.filter(f => {
        const opts = JSON.parse(f.meta.questionOptions ?? "[]") as { code: string; label: string }[];
        const named = opts.find(o => o.code === option);
        return named && clean(f.label).endsWith(clean(named.label));
      });
      if (candidates.length === 1) return candidates[0];
    } else if (found.length === 1) return found[0];
    throw new Error(`Route ${qid}${option ? ` option ${option}` : ""} cannot be bound to exactly one confirmed field.`);
  };
  for (const raw of parts) {
    const term = raw.trim(); let m: RegExpMatchArray | null;
    if (/^(all records|all eligible( adults)?|all eligible respondents)$/i.test(term)) continue;
    if ((m = term.match(/^module (\d+)(?:, all eligible)?$/i))) {
      const candidates = fields.filter(f => /random.*optional module assignment/i.test(f.label));
      if (candidates.length !== 1) throw new Error("The optional-module assignment is missing or ambiguous.");
      assignments.push(codes(candidates[0].variable, m[1])); continue;
    }
    if ((m = term.match(/^assigned (.+)$/i))) {
      const candidates = fields.filter(f => clean(f.label) === clean(`Focal brand assigned: ${m![1]}`));
      if (candidates.length !== 1) throw new Error(`The assignment for ${m[1]} is missing or ambiguous.`);
      const selected = answerCodes(candidates[0], /^(selected|yes)$/);
      if (selected.length !== 1) throw new Error(`The assigned-brand selected code for ${m[1]} is unknown.`);
      assignments.push(codes(candidates[0].variable, selected[0])); continue;
    }
    if ((m = term.match(/^(Q\d+)(?: option (\d+))?\s*=\s*(-?\d+)$/i))) {
      const target = question(m[1], m[2]); conditions.push(all(answeredCondition(target, fields), codes(target.variable, m[3]))!); continue;
    }
    if ((m = term.match(/^(Q\d+) in (\d+)[-\u2013](\d+)$/i))) {
      const target = question(m[1]); conditions.push(all(answeredCondition(target, fields), { op: "range", variable: target.variable, min: Number(m[2]), max: Number(m[3]) })!); continue;
    }
    if ((m = term.match(/^(Q\d+) has a (numeric|substantive) answer$/i))) {
      const target = question(m[1]); conditions.push(all(answeredCondition(target, fields), { op: "answered", variable: target.variable })!); continue;
    }
    if ((m = term.match(/^at least one reason selected at (Q\d+)$/i))) {
      const qid = m[1].toUpperCase();
      const reasons = fields.filter(f => f.questionId?.toUpperCase() === qid && f.meta.stateVariable && !/response-state|stored none/i.test(f.meta.fieldRole ?? ""));
      if (!reasons.length) throw new Error(`The reasons for ${qid} are not confirmed.`);
      const terms = reasons.map(f => {
        const selected = answerCodes(f, /^(selected|yes)$/);
        if (selected.length !== 1) throw new Error(`The selected code for ${f.label} is ambiguous.`);
        return all(answeredCondition(f, fields), codes(f.variable, ...selected))!;
      });
      conditions.push({ op: "any", terms }); continue;
    }
    throw new Error(`The route for ${field.label} needs a researcher decision: ${term}.`);
  }
  return { eligible: all(...conditions), assigned: all(...assignments) };
}
