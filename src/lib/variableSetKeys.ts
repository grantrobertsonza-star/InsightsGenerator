/**
 * Question-set keys are identities ("set:<key>" in saved Brand Health mappings, the set a variable
 * belongs to through its inSet). Dictionaries built before 2026-10-20 could give two sets one key,
 * when a name stem formed both a multiple-response set (its yes/no columns) and a battery or grid
 * (the rest). The engine now keys the second "<stem> (battery)" or "<stem> (grid)"; a cached
 * dictionary that still repeats a key is rebuilt rather than served (crosstabs.ts), so only the
 * affected files are read again.
 */
export function hasRepeatedSetKeys(sets: readonly { key: string }[] | null | undefined): boolean {
  const seen = new Set<string>();
  for (const s of sets ?? []) {
    if (seen.has(s.key)) return true;
    seen.add(s.key);
  }
  return false;
}

/**
 * Saved set choices that may need checking after the keys were made unique: a key that is now the
 * multiple-response set, where the same stem also has a set keyed apart. The choice was computed with
 * the multiple-response set (the engine always took the first set with the key), but a screen may
 * have labelled it with the other, so the researcher is asked to confirm it.
 */
export function setChoicesToCheck(savedSetKeys: readonly string[], sets: readonly { key: string }[]): string[] {
  const keys = new Set(sets.map((s) => s.key));
  return [...new Set(savedSetKeys)].filter((k) => keys.has(`${k} (battery)`) || keys.has(`${k} (grid)`));
}
