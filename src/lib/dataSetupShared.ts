export type DataUnit = "respondents" | "businesses" | "other";
export type DataLayout = "rows_are_cases" | "columns_are_cases";
export type DataMethod = "survey" | "panel" | "administrative" | "other";

/**
 * ANA-NPS-003 (second counter-review): the researcher's own survey-design choice for this
 * document, persisted so every tool that builds a table from it (Cross tabs, the NPS tool,
 * Objectives, brand health, CSM, wave tracking) resolves the same design without each needing its
 * own picker or its own copy of the heuristic - see buildCrosstab in crosstabs.ts, the one place
 * that now reads this field. Three states, not two, because "never decided" and "explicitly no
 * design" are different facts a researcher can assert:
 *  - absent/null on DataSetup ("never decided"): falls through to the name-pattern heuristic
 *    (resolveSurveyDesign with no explicit choice), exactly today's behaviour - so every document
 *    saved before this field existed keeps behaving exactly as it did.
 *  - mode "none": the researcher explicitly chose weights-only, no design. This always wins over
 *    the heuristic, even when it would find an unambiguous PSU.
 *  - mode "explicit": the researcher chose psu/strata (either may be null for a strata-only or
 *    PSU-only design) themselves. This always wins over the heuristic too.
 *  - mode "auto": the researcher explicitly asked for the heuristic to keep deciding (distinct
 *    from "never decided" only in that it is itself a recorded choice, not a default).
 */
export type DataDesignChoice = { mode: "auto" | "explicit" | "none"; psu: string | null; strata: string | null };

export type DataSetup = {
  unit: DataUnit;
  layout: DataLayout;
  method: DataMethod;
  /** The researcher has checked the structure, preview and quality and accepted the data for analysis. */
  accepted: boolean;
  /** Free text ("Wave 1", "Baseline"): which wave of a tracking study this file is. Files left blank
   * here don't show up in Wave tracking at all, so a one-off project never needs to think about it. */
  wave: string | null;
  /** When this wave's fieldwork took place (YYYY-MM or YYYY-MM-DD); orders the waves when every wave has
   * one (src/lib/waves.ts). null: not given, and the waves are then in upload order, said so. */
  waveDate: string | null;
  /** Whether this wave is in wave tracking (Grant, 27 October 2026: "toggle which data sets should be
   * included"). Only meaningful with a wave label; true unless the researcher takes it out. */
  waveIncluded: boolean;
  /** ANA-NPS-003 (second counter-review): the persisted survey-design choice for this document.
   * null means "never decided" (see DataDesignChoice above) - the default for every document,
   * including every one saved before this field existed. */
  design: DataDesignChoice | null;
  /** The header row of a CSV, TSV or Excel data file (Grant's decision 9, second part): how many rows holding text
   * lie above the header, all set aside as title rows. null means detected automatically by the engine
   * (_leading_title_rows), the default for every document, including every one saved before this field existed. A
   * structure setting like `layout`: every engine read of the file passes it, and changing it asks for acceptance
   * again (dataSetupRebase.ts). */
  headerRowsSkipped: number | null;
};

export const DEFAULT_DATA_SETUP: DataSetup = {
  unit: "respondents",
  layout: "rows_are_cases",
  method: "survey",
  accepted: false,
  wave: null,
  waveDate: null,
  waveIncluded: true,
  design: null,
  headerRowsSkipped: null,
};

/**
 * Codex re-review, package 4 (cross-tab handover repair): what the three design-picker controls
 * (CrosstabWorkspace.tsx) should show for a given persisted DataDesignChoice. Extracted as its
 * own pure function so it is the SAME code the component calls from two places - the hydration
 * load and the save effect's conflict-adoption branch - rather than two independently maintained
 * copies of this three-way branch (which is exactly how this codebase's recurring "a parallel
 * path still uses the old behaviour" defects keep happening), and so it is directly testable
 * without rendering the component. The third case (absent, or mode "auto") resets the picker to
 * "not yet decided" rather than leaving whatever was previously shown.
 */
export type DesignPickerState = { psuChoice: string | null; strataChoice: string | null; noDesignChosen: boolean };

export function resolveDesignPickerState(design: DataDesignChoice | null | undefined): DesignPickerState {
  if (design?.mode === "explicit") {
    return { psuChoice: design.psu ?? "", strataChoice: design.strata ?? "", noDesignChosen: false };
  }
  if (design?.mode === "none") {
    return { psuChoice: null, strataChoice: null, noDesignChosen: true };
  }
  return { psuChoice: null, strataChoice: null, noDesignChosen: false };
}

export const UNIT_LABEL: Record<DataUnit, string> = {
  respondents: "People (respondents)",
  businesses: "Businesses or organisations",
  other: "Other units (households, stores, regions)",
};
export const LAYOUT_LABEL: Record<DataLayout, string> = {
  rows_are_cases: "Each row is one case, each column a variable",
  columns_are_cases: "Each column is one case, each row a variable (flipped)",
};
export const METHOD_LABEL: Record<DataMethod, string> = {
  survey: "Survey",
  panel: "Panel or tracking study",
  administrative: "Administrative or transactional records",
  other: "Other",
};

/** The most rows a header row choice sets aside: the Import screen offers rows 1 to 15. The engine's own bound
 * (_HEADER_ROWS_SKIPPED_MAX, api/parse-stats-file.py) is the same; headerRowChoice.test.ts keeps them equal. */
export const HEADER_ROWS_SKIPPED_MAX = 14;

/**
 * A header row choice as sent by a client or read from storage: null (detected automatically) or a whole number from 0
 * to HEADER_ROWS_SKIPPED_MAX. Anything else is invalid, never read as 0 and never as detection; the save action refuses
 * it (dataSetupActions.ts) before anything is written.
 */
export function parseHeaderRowsSkipped(value: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= HEADER_ROWS_SKIPPED_MAX) return { ok: true, value };
  return {
    ok: false,
    error: `The header row must be a row from 1 to ${HEADER_ROWS_SKIPPED_MAX + 1}, or detected automatically.`,
  };
}

/**
 * CSV, TSV, delimited text (.txt) and Excel: the files the engine's one plain-table reader reads
 * (TABLE_EXTS in api/parse-stats-file.py), and so the files with a header row to choose. Asked only of table
 * documents, so a .txt transcript or brief never reaches it. Kept here, with no server import, so the Import screen
 * uses the same rule; parseTable.ts re-exports it.
 */
export function isPlainTableFileName(filename: string): boolean {
  return /\.(csv|tsv|txt|xlsx|xls)$/i.test(filename);
}

function normaliseDesign(value: unknown): DataDesignChoice | null {
  if (value == null || typeof value !== "object") return null;
  const v = value as Partial<DataDesignChoice>;
  if (v.mode !== "auto" && v.mode !== "explicit" && v.mode !== "none") return null;
  const psu = typeof v.psu === "string" && v.psu.trim() ? v.psu.trim() : null;
  const strata = typeof v.strata === "string" && v.strata.trim() ? v.strata.trim() : null;
  return { mode: v.mode, psu, strata };
}

/** A fieldwork date as YYYY-MM or YYYY-MM-DD (a real month and day); anything else is "not given". */
export function normaliseWaveDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(t);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  if (m[3] !== undefined) {
    const d = new Date(Date.UTC(Number(m[1]), month - 1, Number(m[3])));
    if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== Number(m[3])) return null;
  }
  return t;
}

export function normaliseDataSetup(value: unknown): DataSetup {
  const v = (value ?? {}) as Partial<DataSetup>;
  const wave = typeof v.wave === "string" ? v.wave.trim() : "";
  return {
    unit: v.unit && v.unit in UNIT_LABEL ? v.unit : DEFAULT_DATA_SETUP.unit,
    layout: v.layout && v.layout in LAYOUT_LABEL ? v.layout : DEFAULT_DATA_SETUP.layout,
    method: v.method && v.method in METHOD_LABEL ? v.method : DEFAULT_DATA_SETUP.method,
    accepted: v.accepted === true,
    wave: wave.length > 0 ? wave : null,
    waveDate: normaliseWaveDate(v.waveDate),
    waveIncluded: v.waveIncluded !== false,
    design: normaliseDesign(v.design),
    // Only the save action writes this field, and it refuses an invalid value first; a stored value that is somehow
    // invalid (a hand edit) reads as detected automatically, the behaviour every file had before the choice existed,
    // and the save action refuses to write it back.
    headerRowsSkipped: ((r) => (r.ok ? r.value : null))(parseHeaderRowsSkipped(v.headerRowsSkipped)),
  };
}
