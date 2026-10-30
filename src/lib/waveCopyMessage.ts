// What "Copy here" in Cross tabs tells the researcher (Grant, 29 October 2026: a copy "didnt seem to work"). It says
// how many tables the other wave holds, how many were copied, already there, or could not be rebuilt, and where the
// copies are listed: under All tables, since a copy keeps the way its original was made (a StarterTabs table is
// not listed under CrossTabs).
export type WaveCopyResult = { tables: number; built: number; alreadyCopied: number; skipped: { label: string; reason: string }[] };

export function waveCopyMessage(r: WaveCopyResult, fromWave: string): { text: string; tone: "success" | "error"; showTables: boolean } {
  if (r.tables === 0) return { text: `${fromWave} has no saved tables to copy.`, tone: "error", showTables: false };
  const parts: string[] = [];
  if (r.built > 0) parts.push(`Copied ${r.built} ${r.built === 1 ? "table" : "tables"} from ${fromWave} as ${r.built === 1 ? "a draft" : "drafts"}, listed under All tables.`);
  if (r.alreadyCopied > 0) parts.push(`${r.alreadyCopied} ${r.alreadyCopied === 1 ? "table was" : "tables were"} already copied here, so ${r.alreadyCopied === 1 ? "it was" : "they were"} not copied again.`);
  if (r.skipped.length > 0) parts.push(`${r.skipped.length} could not be rebuilt here: ${r.skipped.map((s) => `${s.label} (${s.reason})`).join("; ")}`);
  return { text: parts.join(" "), tone: r.built === 0 && r.alreadyCopied === 0 ? "error" : "success", showTables: r.built > 0 || r.alreadyCopied > 0 };
}
