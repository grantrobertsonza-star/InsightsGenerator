// Reads the skip instruction printed beside a questionnaire item ("ASK IF
// Q5 = 1 OR 2", "Only if Q7 not 3 and Q8 = 1") into a condition the data
// quality check can apply. Pure. It only understands simple, explicit
// conditions on a question code. Anything it cannot read confidently returns
// null, and the item is then treated as having no stated routing, so the
// detected routing remains the fallback.

export type RoutingClause = { code: string; values: string[]; negate: boolean };
export type Routing = {
  combine: "all" | "any";
  clauses: RoutingClause[];
  /**
   * Present when the instruction mixes AND and OR. An OR of ANDs: eligible if
   * every clause in at least one group holds. `clauses` then holds all clauses
   * flattened, so the gate questions can still be listed.
   */
  groups?: RoutingClause[][];
};

const TRIGGER = /\b(?:ask only if|ask if|ask those who|asked if|only if|filter\s*:|base\s*:|if)\b(.*)$/i;
const ALL = /\b(?:ask all|all respondents|everyone|everybody|all asked)\b/i;
const CODE = "[A-Za-z]{1,4}\\d{1,3}[A-Za-z]?(?:[._]\\d{1,3})?";
const CLAUSE = new RegExp(
  `(${CODE})\\s*(==|=|!=|<>|\\u2260|is not|is|are not|are|not|in|:)?\\s*(?:(code|codes|answer|answers)\\s*)?(\\d[\\d\\s,/\\-\\u2013]*(?:\\s*(?:or|and|&)\\s*\\d[\\d\\s,/\\-\\u2013]*)*)`,
  "gi",
);

function expandValues(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/,|\bor\b|\band\b|&|\//i)) {
    const t = part.trim();
    if (!t) continue;
    const range = /^(\d{1,3})\s*[-–]\s*(\d{1,3})$/.exec(t);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (b >= a && b - a <= 30) for (let i = a; i <= b; i++) out.push(String(i));
      continue;
    }
    if (/^\d{1,4}$/.test(t)) out.push(String(Number(t)));
  }
  return [...new Set(out)];
}

export function parseRouting(text: string | null | undefined): Routing | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || (ALL.test(t) && !/\bif\b/i.test(t))) return null;
  const trig = TRIGGER.exec(t);
  if (!trig) return null;
  const body = trig[1];

  const clauses: RoutingClause[] = [];
  const joins: string[] = [];
  let lastEnd = -1;
  CLAUSE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLAUSE.exec(body)) !== null) {
    const op = (m[2] ?? "").toLowerCase();
    const values = expandValues(m[4]);
    if (values.length === 0) continue;
    if (lastEnd >= 0) {
      const between = body.slice(lastEnd, m.index);
      joins.push(/\bor\b/i.test(between) ? "or" : /\band\b|&|;|,/i.test(between) ? "and" : "and");
    }
    clauses.push({
      code: m[1],
      values,
      negate: /not|!=|<>|≠/.test(op),
    });
    lastEnd = m.index + m[0].length;
  }
  if (clauses.length === 0) return null;
  const allAnd = joins.every((j) => j === "and");
  const allOr = joins.every((j) => j === "or");
  if (allAnd) return { combine: "all", clauses };
  if (allOr) return { combine: "any", clauses };
  // Mixed: AND binds tighter than OR, so split on OR into groups of ANDs.
  const groups: RoutingClause[][] = [[clauses[0]]];
  joins.forEach((j, i) => {
    if (j === "or") groups.push([clauses[i + 1]]);
    else groups[groups.length - 1].push(clauses[i + 1]);
  });
  return { combine: "any", clauses, groups };
}

function clauseHolds(c: RoutingClause, a: string | null | undefined): boolean | null {
  if (a === null || a === undefined || a === "") return null; // gate unanswered: cannot tell
  const hit = c.values.includes(String(a));
  return c.negate ? !hit : hit;
}

/** Whether a case is expected to have been asked, given the gate answers (code to chosen option code). Null when a needed gate is unanswered. */
export function isEligible(routing: Routing, answers: Record<string, string | null | undefined>): boolean | null {
  const all = (cs: RoutingClause[]): boolean | null => {
    let unknown = false;
    for (const c of cs) {
      const r = clauseHolds(c, answers[c.code]);
      if (r === false) return false;
      if (r === null) unknown = true;
    }
    return unknown ? null : true;
  };
  if (routing.groups) {
    let unknown = false;
    for (const g of routing.groups) {
      const r = all(g);
      if (r === true) return true;
      if (r === null) unknown = true;
    }
    return unknown ? null : false;
  }
  if (routing.combine === "any") {
    let unknown = false;
    for (const c of routing.clauses) {
      const r = clauseHolds(c, answers[c.code]);
      if (r === true) return true;
      if (r === null) unknown = true;
    }
    return unknown ? null : false;
  }
  return all(routing.clauses);
}
