import type { Routing } from "./routingParse";

// Turns confirmed questionnaire links into stated routing the data quality
// check can apply. Pure. A rule is only produced when every question it
// depends on is itself linked to a variable and has its answer options, so
// the gate's answers in the data can be turned back into questionnaire codes.

export type StatedRouting = {
  /** Header of the variable the skip instruction belongs to. */
  header: string;
  /** The instruction as printed, for display. */
  text: string;
  routing: Routing;
  /** By questionnaire code: the gate variable's header and its answer options. */
  gates: Record<string, { header: string; options: { code: string; label: string }[] }>;
};

export type ConfirmedItemLike = {
  variable: string;
  code: string | null;
  options: { code: string; label: string }[];
  routing: Routing | null;
  routingText?: string | null;
  /** Defaults to true. A false item can serve as a gate but never has its own rule applied. */
  confirmed?: boolean;
};

export function buildStatedRouting(
  items: ConfirmedItemLike[],
  variables: { name: string; label: string }[],
): StatedRouting[] {
  const labelOf = new Map(variables.map((v) => [v.name, v.label || v.name]));
  const gateByCode = new Map<string, { header: string; options: { code: string; label: string }[] }>();
  for (const it of items) {
    if (!it.code || it.options.length === 0) continue;
    const key = it.code.toLowerCase();
    if (!gateByCode.has(key)) gateByCode.set(key, { header: labelOf.get(it.variable) ?? it.variable, options: it.options });
  }
  const out: StatedRouting[] = [];
  const done = new Set<string>();
  for (const it of items) {
    if (!it.routing || it.confirmed === false) continue;
    const header = labelOf.get(it.variable) ?? it.variable;
    if (done.has(header)) continue;
    const gates: StatedRouting["gates"] = {};
    let ok = true;
    for (const c of it.routing.clauses) {
      const g = gateByCode.get(c.code.toLowerCase());
      if (!g) {
        ok = false;
        break;
      }
      gates[c.code] = g;
    }
    if (!ok) continue;
    done.add(header);
    out.push({ header, text: it.routingText ?? "", routing: it.routing, gates });
  }
  return out;
}
