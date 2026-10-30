// Finding a question in a long variable list (CB1, Grant 29 October 2026: "the variable list is long, needs a
// smart search option"). Display and choice only: the chosen variable's name is its identity; nothing here decides
// what a variable means.
//
// A variable matches when every word typed starts a word of its name or label, or appears inside its name
// ("aware" finds Aware_Toyota and "Prompted resolved recognition Toyota"; "q12" finds Q12_3). Research words are
// read with their common other forms, so "awareness" also finds "recognition" and "recall", "nps" finds
// "recommend", "churn" finds "switch". Order: the name itself, then names starting with what was typed, then
// whole-word matches in the label, then the rest; ties keep the file's order.

export type SearchableVariable = { name: string; label: string };

const OTHER_FORMS: Record<string, string[]> = {
  aware: ["awareness", "recognition", "recognise", "recognize", "recall", "heard"],
  consider: ["consideration", "considered"],
  nps: ["recommend", "recommendation", "promoter"],
  recommend: ["nps", "promoter"],
  satisf: ["satisfaction", "satisfied", "csat", "happy"],
  csat: ["satisfaction", "satisfied"],
  switch: ["churn", "leave", "change"],
  churn: ["switch", "leave"],
  stay: ["retain", "retention", "loyal", "loyalty", "remain"],
  loyal: ["stay", "retain", "loyalty"],
  purchase: ["buy", "bought", "purchased"],
  buy: ["purchase", "bought"],
  trial: ["tried", "ever used", "ever bought"],
  usage: ["use", "used", "usage"],
  weight: ["wgt", "wt"],
};

/** A name's words: "AgentEmpathy_Courtesy_0to10" gives agent, empathy, courtesy, 0, to, 10. */
function wordsOf(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9\u00C0-\uFFFF]+/)
    .filter(Boolean);
}

function formsOf(token: string): string[] {
  const out = new Set([token]);
  for (const [stem, forms] of Object.entries(OTHER_FORMS)) {
    if (token.startsWith(stem) || (stem.startsWith(token) && token.length >= 3)) for (const f of forms) out.add(f);
  }
  return [...out];
}

/** The variables matching what was typed, best first. An empty query returns the list as it is. */
export function searchVariables<T extends SearchableVariable>(query: string, variables: T[]): T[] {
  const typed = query.trim().toLowerCase();
  if (!typed) return variables;
  const tokens = typed.split(/[\s,;]+/).filter(Boolean);
  const scored: { v: T; score: number; i: number }[] = [];
  variables.forEach((v, i) => {
    const name = v.name.toLowerCase();
    const nameWords = wordsOf(v.name);
    const labelWords = wordsOf(v.label);
    const all = [...nameWords, ...labelWords];
    let score = 0;
    for (const t of tokens) {
      const forms = formsOf(t);
      const inName = name.includes(t);
      const wordStart = forms.some((f) => {
        const fw = f.split(" ");
        return fw.length > 1 ? v.label.toLowerCase().includes(f) : all.some((w) => w.startsWith(f));
      });
      if (!inName && !wordStart) return;
      if (labelWords.includes(t) || nameWords.includes(t)) score += 3;
      else if (wordStart) score += 2;
      else score += 1;
    }
    if (name === typed) score += 100;
    else if (name.startsWith(typed)) score += 50;
    scored.push({ v, score, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((s) => s.v);
}
