// Suggests which questionnaire item a model term group came from, for example
// the term group "Education" and the item "What is the highest level of
// education you have completed?". Pure. A suggestion only: derived measures
// (scores, segments) have no item and get no match, and every match is
// worded as something to check.

import { tokenSet, type ItemLike } from "./instrumentMatch";

export type ItemMatch = { itemId: string; code: string | null; text: string; confidence: "medium" | "low" };

const JACCARD_LOW = 0.12;
const JACCARD_MEDIUM = 0.3;

export function matchGroupToItem(group: string, items: ItemLike[]): ItemMatch | null {
  const gt = tokenSet(group.replace(/\([^)]*\)/g, " "));
  if (gt.size === 0 || items.length === 0) return null;
  let best: { item: ItemLike; j: number } | null = null;
  for (const item of items) {
    const it = tokenSet(item.text);
    if (it.size === 0) continue;
    let inter = 0;
    for (const w of gt) if (it.has(w)) inter++;
    if (inter < gt.size) continue; // every word of the group label must appear in the wording
    const j = inter / (gt.size + it.size - inter);
    if (!best || j > best.j) best = { item, j };
  }
  if (!best || best.j < JACCARD_LOW) return null;
  return { itemId: best.item.id, code: best.item.code, text: best.item.text, confidence: best.j >= JACCARD_MEDIUM ? "medium" : "low" };
}
