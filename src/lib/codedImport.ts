// Reads a researcher's own coding of a transcript, from a spreadsheet or a
// Word table, into plain (code, quote) pairs. Pure functions only: the file
// reading is in codedImportFile.ts and the transcript matching is in
// extractThemes.ts, so this part can be tested on its own.
//
// Three shapes are understood, because that is what people actually have:
//   1. A theme table: one row per theme (or per quote), with a theme/code
//      column and a quote column, optionally a definition and counts.
//   2. Coded sentences: one row per quote, with the code(s) in another
//      column. ATLAS.ti's quotation report (Quotation Content + Codes) is
//      this shape. Several codes in one cell can be split with new lines,
//      semicolons or "|" (not commas, because code names contain commas).
//   3. A coding matrix: one row per sentence, one column per code, with
//      1/x/yes in the cells that apply.
// Counts in the file are ignored on purpose: the app recounts from the
// transcript so the numbers are checkable.

export type ImportEntry = {
  code: string;
  quote: string | null;
  definition: string | null;
  // The broader theme this code sits under (Theme > Sub-theme / code).
  theme: string | null;
  inclusion: string | null;
  exclusion: string | null;
  keywords: string | null;
};

export type ImportCode = {
  name: string;
  definition: string | null;
  theme: string | null;
  inclusion: string | null;
  exclusion: string | null;
  keywords: string | null;
};

export type ParsedCoding = {
  entries: ImportEntry[];
  // Unique codes in order of first appearance, with a definition when the
  // file gave one.
  codes: ImportCode[];
  shape: "table" | "matrix";
  warnings: string[];
};

type Role =
  | "code"
  | "quote"
  | "definition"
  | "inclusion"
  | "exclusion"
  | "keywords"
  | "count"
  | "document"
  | "other";

const NOT_QUOTE = /(name|\bid\b|comment|memo|note|reference|position|count|freq|number|^no\.?$|grounded|density)/i;

export function classifyHeader(header: string): Role {
  const h = header.trim().toLowerCase();
  if (!h) return "other";
  // "Category ID", "Participant IDs": identifiers, never a code name.
  if (/\bids?\b/.test(h) && !/quot/.test(h)) return "other";
  if (/(inclusion|include when|applies when)/.test(h)) return "inclusion";
  if (/(exclusion|exclude when|does not apply)/.test(h)) return "exclusion";
  if (/(key ?words?|key phrases?|search terms?)/.test(h)) return "keywords";
  if (/(definition|description|meaning|what it means|criteria)/.test(h))
    return "definition";
  if (/(count|freq|frequency|references|mentions|how many|^n$|^no\.?$|number of)/.test(h))
    return "count";
  if (/(^document|^file|transcript name|^source$|^interview$)/.test(h))
    return "document";
  if (
    /(quot|excerpt|verbatim|segment|extract|passage|sentence|statement|response|content|\btext\b|illustrat|example)/.test(
      h,
    ) &&
    !NOT_QUOTE.test(h.replace(/quotation content|quote content/, ""))
  )
    return "quote";
  if (/^(codes?|themes?|code name|theme name|categor(y|ies)|nodes?|labels?|tags?|concepts?|code\/theme|theme\/code)$/.test(h))
    return "code";
  if (/(^|\b)(code|theme|node|categor|concept)/.test(h)) return "code";
  return "other";
}

function clean(cell: string): string {
  return cell.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

function splitCodes(cell: string): string[] {
  return cell
    .split(/[\n;|]/)
    .map((c) => clean(c.replace(/^(?:[\s•\-–*]+|\d+[.)]\s+)/, "")))
    .filter((c) => c.length > 0 && c.length <= 160);
}

const ATTRIBUTION = /\s*[(\[]\s*[A-Za-z]{1,12}[_\s-]?\d+[^)\]]*[)\]]\s*$/;

function quotedSpans(line: string): string[] {
  const spans: string[] = [];
  for (const m of line.matchAll(/["\u201c\u201d]([^"\u201c\u201d]{12,})["\u201c\u201d]/g)) {
    spans.push(clean(m[1]));
  }
  return spans;
}

function splitQuotes(cell: string): string[] {
  const raw = cell
    .split(/\r?\n+/)
    .map((l) => clean(l.replace(/^[\s•\-–*]+|^\d+[.)]\s+/, "")))
    .filter((l) => l.length > 0);
  // A line that carries its own quotation marks (with an attribution such as
  // "(P3, Line 45)" around them) contributes just the quoted words.
  const lines: string[] = [];
  for (const l of raw) {
    const spans = quotedSpans(l);
    if (spans.length > 0) lines.push(...spans);
    else lines.push(l.replace(ATTRIBUTION, "").replace(/^["\u201c\u201d']+|["\u201c\u201d']+$/g, "").trim());
  }
  const kept = lines.filter((l) => l.length > 0);
  if (kept.length <= 1) return kept;
  // A wrapped sentence is one quote; a list of quotes is several.
  if (raw.some((l) => quotedSpans(l).length > 0) || kept.every((l) => l.length >= 25)) return kept;
  return [kept.join(" ")];
}

const TRUTHY = /^(1|x|y|yes|true|✓|✔|tick|\+)$/i;

function findHeaderRow(grid: string[][], hasFallback: boolean): number {
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const roles = grid[r].map((c) => classifyHeader(c));
    const hasCode = roles.includes("code");
    const hasQuote = roles.includes("quote");
    const hasDef =
      roles.includes("definition") ||
      roles.includes("inclusion") ||
      roles.includes("exclusion");
    if (hasCode && (hasQuote || hasDef)) return r;
  }
  // Matrix: a quote column plus several short headers with 0/1-like cells.
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const roles = grid[r].map((c) => classifyHeader(c));
    if (
      roles.includes("quote") &&
      grid[r].filter((c) => clean(c)).length >= (hasFallback ? 1 : 3)
    )
      return r;
  }
  return -1;
}

export function parseCodingGrid(
  grid: string[][],
  fallbackCodeName: string | null = null,
): ParsedCoding {
  const warnings: string[] = [];
  const headerRow = findHeaderRow(grid, fallbackCodeName !== null);
  if (headerRow < 0) {
    return { entries: [], codes: [], shape: "table", warnings: ["no header row found"] };
  }
  const header = grid[headerRow].map((h) => clean(h));
  const roles = header.map(classifyHeader);
  const pick = (role: Role) => roles.indexOf(role);
  // Two code-like columns ("Theme" and "Sub-theme / Code"): the more specific
  // one is the code, the broader one is kept as context in the definition.
  const codeCols = roles.map((r, i) => (r === "code" ? i : -1)).filter((i) => i >= 0);
  const specific = codeCols.find((i) => /sub|\bcode\b/i.test(header[i]));
  const codeCol = codeCols.length > 1 && specific !== undefined ? specific : (codeCols[0] ?? -1);
  const parentCol = codeCols.length > 1 ? codeCols.find((i) => i !== codeCol) ?? -1 : -1;
  let parent = "";
  const quoteCol = pick("quote");
  const defCol = pick("definition");
  const incCol = pick("inclusion");
  const excCol = pick("exclusion");
  const kwCol = pick("keywords");
  const body = grid.slice(headerRow + 1).filter((r) => r.some((c) => clean(c)));

  const entries: ImportEntry[] = [];
  let shape: ParsedCoding["shape"] = "table";
  let skippedNoCode = 0;

  if (codeCol < 0 && quoteCol >= 0 && !fallbackCodeName) {
    // Matrix shape: every other non-empty header is a code column.
    shape = "matrix";
    const matrixCols = header
      .map((h, i) => ({ h, i }))
      .filter(
        ({ h, i }) =>
          i !== quoteCol &&
          h &&
          roles[i] !== "count" &&
          roles[i] !== "document" &&
          body.some((r) => TRUTHY.test(clean(r[i] ?? ""))),
      );
    if (matrixCols.length === 0) {
      return { entries: [], codes: [], shape, warnings: ["no code columns found"] };
    }
    for (const row of body) {
      const quote = clean(row[quoteCol] ?? "");
      if (!quote) continue;
      for (const { h, i } of matrixCols) {
        if (TRUTHY.test(clean(row[i] ?? ""))) {
          entries.push({ code: h, quote, definition: null, theme: null, inclusion: null, exclusion: null, keywords: null });
        }
      }
    }
  } else {
    for (const row of body) {
      const codes =
        codeCol >= 0
          ? splitCodes(row[codeCol] ?? "")
          : fallbackCodeName
            ? [fallbackCodeName]
            : [];
      const quotes = quoteCol >= 0 ? splitQuotes(row[quoteCol] ?? "") : [];
      if (parentCol >= 0) {
        const p = clean(row[parentCol] ?? "");
        if (p) parent = p; // a theme written once above several sub-themes
      }
      const definition = defCol >= 0 ? clean(row[defCol] ?? "") || null : null;
      const inclusion = incCol >= 0 ? clean(row[incCol] ?? "") || null : null;
      const exclusion = excCol >= 0 ? clean(row[excCol] ?? "") || null : null;
      const keywords = kwCol >= 0 ? clean(row[kwCol] ?? "") || null : null;
      const theme = parentCol >= 0 && parent ? parent : null;
      const meta = { definition, theme, inclusion, exclusion, keywords };
      if (codes.length === 0) {
        if (quotes.length > 0) skippedNoCode += 1;
        continue;
      }
      for (const code of codes) {
        if (quotes.length === 0) entries.push({ code, quote: null, ...meta });
        else for (const q of quotes) entries.push({ code, quote: q, ...meta });
      }
    }
  }

  if (skippedNoCode > 0)
    warnings.push(
      `${skippedNoCode} row${skippedNoCode === 1 ? "" : "s"} had a quote but no code and ${skippedNoCode === 1 ? "was" : "were"} skipped`,
    );
  if (roles.includes("count"))
    warnings.push(
      "the counts in your file were ignored: the app recounts from the transcript so every number can be checked",
    );

  return { entries, codes: uniqueCodes(entries), shape, warnings };
}

export function uniqueCodes(entries: ImportEntry[]): ImportCode[] {
  const seen = new Map<string, ImportCode>();
  for (const e of entries) {
    const key = e.code.toLowerCase();
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, {
        name: e.code,
        definition: e.definition,
        theme: e.theme,
        inclusion: e.inclusion,
        exclusion: e.exclusion,
        keywords: e.keywords,
      });
    } else {
      existing.definition ||= e.definition;
      existing.theme ||= e.theme;
      existing.inclusion ||= e.inclusion;
      existing.exclusion ||= e.exclusion;
      existing.keywords ||= e.keywords;
    }
  }
  return [...seen.values()];
}

/** Merges the parse of several sheets or tables of the same file. */
export function mergeParsed(parts: ParsedCoding[]): ParsedCoding {
  const entries = parts.flatMap((p) => p.entries);
  return {
    entries,
    codes: uniqueCodes(entries),
    shape: parts.some((p) => p.shape === "matrix") ? "matrix" : "table",
    warnings: [...new Set(parts.flatMap((p) => p.warnings))],
  };
}

/**
 * Reads a Word "themed data extract": headings or lines such as
 * "THEME A: Digital fatigue" and "Code: Always-on expectation", followed by
 * bullets that hold a participant's words in quotation marks. Lines in
 * [square brackets] are the researcher's own notes and are ignored.
 */
export function parseCodedParagraphs(lines: string[]): ParsedCoding {
  const entries: ImportEntry[] = [];
  let theme = "";
  let code = "";
  for (const line of lines.map(clean).filter(Boolean)) {
    if (line.startsWith("[")) continue;
    const t = /^(?:main\s+|global\s+)?theme\b[^:\n]{0,12}:\s*(.+)$/i.exec(line);
    if (t) {
      theme = clean(t[1]);
      code = "";
      continue;
    }
    const c = /^(?:sub-?theme|code|category)\s*:\s*(.+)$/i.exec(line);
    if (c) {
      code = clean(c[1]);
      entries.push({
        code,
        quote: null,
        definition: null,
        theme: theme || null,
        inclusion: null,
        exclusion: null,
        keywords: null,
      });
      continue;
    }
    const spans = quotedSpans(line);
    const owner = code || theme;
    if (spans.length > 0 && owner) {
      const longest = spans.sort((a, b) => b.length - a.length)[0];
      entries.push({
        code: owner,
        quote: longest,
        definition: null,
        theme: code && theme ? theme : null,
        inclusion: null,
        exclusion: null,
        keywords: null,
      });
    }
  }
  return {
    entries,
    codes: uniqueCodes(entries),
    shape: "table",
    warnings: [],
  };
}
