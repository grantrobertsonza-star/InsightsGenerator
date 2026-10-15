/**
 * Strips a leading number, hyphen/asterisk, or Unicode bullet from one line, the same way
 * parseObjectiveLines below strips it from every line it splits out of a block of text.
 * Exported separately (OBJ-SET-M02) so a SINGLE line written outside that split - most
 * notably editStatedObjective's replacement text - can be normalized the same way before
 * it is stored, not only when the text is later re-parsed on read. Without this, a line
 * saved as typed ("• B") and a line saved already-stripped ("B") were never the same string
 * to any later exact-text match (the candidate-sync lookup in editStatedObjective, the
 * duplicate-add guard in objectiveCandidateActions.ts, the carry-over check in
 * objectiveFramer.ts) even though display, which always re-parses through
 * parseObjectiveLines, showed them identically - so an edit of the DISPLAYED (stripped)
 * text could never find the row stored with its bullet still attached, and silently
 * inserted a second candidate instead of updating the one that was actually there.
 */
export function normalizeObjectiveLine(line: string): string {
  return line.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim();
}

/**
 * The one objective-list parser (OBJ-SET-M02). runContextActions.ts's
 * saveRunContext merge step and editStatedObjective, and the Setup page's
 * own list-display logic, each used to carry their own copy of this with
 * different rules (most importantly, only one of them dropped a bare
 * heading line like "Secondary objectives:"), so the same stored text could
 * come back as a different set of lines depending on which code path read
 * it. Kept in its own plain module (not alongside the "use server" actions
 * in runContextActions.ts, whose exports must all be async server actions)
 * so a server component like the run page can import it directly too.
 *
 * Strips a leading number, hyphen/asterisk, or Unicode bullet from each
 * line, drops blank lines, and drops a heading-only line (ends with ":" and
 * is 8 words or fewer) - a heading is never itself an objective, wherever
 * this is called from.
 */
export function parseObjectiveLines(text: string | null): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map(normalizeObjectiveLine)
    .filter((l) => l.length > 0)
    .filter((l) => !(l.endsWith(":") && l.split(/\s+/).length <= 8));
}
