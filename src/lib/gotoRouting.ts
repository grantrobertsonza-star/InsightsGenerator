import type { Routing, RoutingClause } from "./routingParse";

// Questionnaires often route by sending people to a later question ("No: GO
// TO Q10") instead of printing "ASK IF" on every skipped item. This turns
// those jumps into the same condition form: an item is not asked of anyone
// whose earlier answer sent them past it. Pure.

export type GotoOption = { code: string; label: string; goto?: string | null };
export type GotoItem = { code: string | null; routing: Routing | null; options: GotoOption[] };

export const MAX_DERIVED_CLAUSES = 8;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const isEnd = (s: string) => /^(end|exit|finish|terminate|close|thank)/i.test(s.trim());

/** Returns one routing per item: its own, plus conditions derived from earlier jumps that skip over it. */
export function deriveGotoRouting(items: GotoItem[]): (Routing | null)[] {
  const indexByCode = new Map<string, number>();
  items.forEach((it, i) => {
    if (it.code && !indexByCode.has(norm(it.code))) indexByCode.set(norm(it.code), i);
  });

  // For each gate item, the jumps it makes: option code and the index it lands on.
  const jumps: { gate: number; option: string; target: number }[] = [];
  items.forEach((it, g) => {
    if (!it.code) return;
    for (const o of it.options) {
      if (!o.goto || !o.code) continue;
      const target = isEnd(o.goto) ? Number.POSITIVE_INFINITY : indexByCode.get(norm(o.goto));
      if (target === undefined || target <= g + 1) continue;
      jumps.push({ gate: g, option: o.code, target });
    }
  });

  return items.map((it, x) => {
    const byGate = new Map<number, string[]>();
    for (const j of jumps) {
      if (j.gate < x && j.target > x) byGate.set(j.gate, [...(byGate.get(j.gate) ?? []), j.option]);
    }
    if (byGate.size === 0) return it.routing;
    const derived: RoutingClause[] = [];
    for (const [g, values] of byGate) {
      derived.push({ code: items[g].code as string, values: [...new Set(values)], negate: true });
      if (derived.length >= MAX_DERIVED_CLAUSES) break;
    }
    const r = it.routing;
    if (!r) return { combine: "all", clauses: derived };
    const base = r.groups ?? (r.combine === "any" ? r.clauses.map((c) => [c]) : [r.clauses]);
    const groups = base.map((g) => [...g, ...derived]);
    if (groups.length === 1) return { combine: "all", clauses: groups[0] };
    return { combine: "any", clauses: groups.flat(), groups };
  });
}
