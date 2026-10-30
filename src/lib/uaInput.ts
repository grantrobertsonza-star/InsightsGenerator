import { getConfirmedItemsForData } from "./instruments";
import { loadRoleInput } from "./trackerInput";
import type { UaField } from "./uaTypes";

/** Use the same confirmed labels and canonical variables as a Cross tab, with the reader's declared rules. */
export async function loadUaFields(tenantId: string, runId: string, documentId: string) {
  const [input, items] = await Promise.all([loadRoleInput(tenantId, runId, documentId), getConfirmedItemsForData(tenantId, runId, documentId)]);
  const descriptions = new Map<string, typeof items[number]>();
  for (const item of items) if (item.confirmed && item.instrumentType === "codebook" && item.questionMeta?.researchMeta && !descriptions.has(item.variable)) descriptions.set(item.variable, item);
  const fields: UaField[] = input.variables.map(v => {
    const item = descriptions.get(v.name);
    return { variable: v.name, label: item?.text || v.label, questionId: item?.questionMeta?.questionId ?? null, options: Object.entries(v.valueLabels ?? {}).map(([code, label]) => ({ code, label })), meta: item?.questionMeta?.researchMeta ?? {} };
  });
  return { fields };
}
