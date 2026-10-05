import { withTenant } from "./db";

// A lightweight, no-extra-API-calls way of spotting findings that are
// probably the same finding stated more than once (e.g. a number quoted in
// both a written report and a slide deck built from the same data). This
// deliberately does not try to guess whether two findings come from
// genuinely independent research, that's a judgment call left to the
// person reviewing them; this just flags "these look alike, take a look".

const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "on", "for", "to", "and", "or", "is", "are",
  "was", "were", "has", "have", "had", "that", "this", "these", "those",
  "by", "with", "as", "at", "its", "it", "their", "among", "between",
  "than", "most", "least", "more", "less", "not", "be", "which", "who",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9%.\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1 && !STOPWORDS.has(word))
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// How similar two findings' wording needs to be before they're treated as
// the same finding. Tuned to catch near-identical restatements (the usual
// case when a deck is built from a report) without lumping together
// findings that just happen to share a topic.
const DUPLICATE_THRESHOLD = 0.55;

/**
 * Groups findings whose wording is close enough to be the same finding
 * stated more than once. Returns only groups with 2 or more members;
 * anything with no close match is left out entirely.
 */
export function findDuplicateGroups(
  findings: { id: string; finding_text: string }[]
): string[][] {
  const tokenSets = findings.map((c) => tokenize(c.finding_text));

  const parent = new Map<string, string>();
  for (const finding of findings) parent.set(finding.id, finding.id);

  function find(id: string): string {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  }
  function union(a: string, b: string) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  }

  for (let i = 0; i < findings.length; i++) {
    for (let j = i + 1; j < findings.length; j++) {
      if (jaccardSimilarity(tokenSets[i], tokenSets[j]) >= DUPLICATE_THRESHOLD) {
        union(findings[i].id, findings[j].id);
      }
    }
  }

  const groups = new Map<string, string[]>();
  for (const finding of findings) {
    const root = find(finding.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(finding.id);
  }

  return Array.from(groups.values()).filter((group) => group.length > 1);
}

/**
 * Groups code-generated findings that are exact structural repeats of one
 * another -- same source table, same underlying cells, same wording. This
 * is deliberately NOT the fuzzy Jaccard check above: a generated finding's
 * wording is a fixed sentence template (see bannerPlanComputation.ts), so
 * two generated findings about two different schools, or two different
 * variables, routinely share 60-80% of their tokens through the template
 * alone -- "School X has a single Y reading of Z, too little data in this
 * group alone to test against the others" barely changes word to word.
 * Comparing them by wording similarity flags nearly every such finding in
 * a run as a duplicate of every other one, regardless of topic. A
 * generated finding is already guaranteed unique by construction (one per
 * banner-category x stub-column pairing, and archiveAndReplaceFindings
 * clears a table's previous findings before writing fresh ones), so the
 * only way two of them are a genuine repeat is if they trace back to the
 * exact same table and the exact same rows.
 */
export function findGeneratedDuplicateGroups(
  findings: { id: string; finding_text: string; source_table_id: string | null; source_cells: string | null }[]
): string[][] {
  const byKey = new Map<string, string[]>();
  for (const f of findings) {
    const key = `${f.source_table_id ?? ""}::${f.source_cells ?? ""}::${f.finding_text}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(f.id);
  }
  return Array.from(byKey.values()).filter((group) => group.length > 1);
}

/**
 * Re-scans every non-rejected finding in a run and refreshes which ones are
 * flagged as probable duplicates of each other. Safe to call repeatedly:
 * it clears the previous grouping first, so once someone rejects the
 * redundant copy of a finding, the survivor stops being flagged next time
 * this runs.
 *
 * Generated (code-computed) findings and narrative (model-authored)
 * findings are deduped separately and by different rules -- see
 * findGeneratedDuplicateGroups above for why wording similarity is the
 * wrong check for the former.
 */
export async function detectDuplicateFindings(tenantId: string, runId: string): Promise<void> {
  const findings = await withTenant(tenantId, async (client) => {
    const result = await client.query<{
      id: string;
      finding_text: string;
      origin: string;
      source_table_id: string | null;
      source_cells: string | null;
    }>(
      "select id, finding_text, origin, source_table_id, source_cells from findings where run_id = $1 and status != 'rejected'",
      [runId]
    );
    return result.rows;
  });

  const generated = findings.filter((f) => f.origin === "generated");
  const narrative = findings.filter((f) => f.origin !== "generated");

  const groups = [...findGeneratedDuplicateGroups(generated), ...findDuplicateGroups(narrative)];

  await withTenant(tenantId, async (client) => {
    await client.query("update findings set duplicate_group_id = null where run_id = $1", [runId]);

    for (const group of groups) {
      const groupId = [...group].sort()[0];
      await client.query(
        "update findings set duplicate_group_id = $1 where id = any($2::uuid[])",
        [groupId, group]
      );
    }
  });
}
