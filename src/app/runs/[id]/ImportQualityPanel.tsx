import type { StatedRouting } from "@/lib/statedRouting";
import {
  computeTableQuality,
  type TableQuality,
  type VariableType,
  type CellValue,
  type QualityStatus,
} from "@/lib/dataQuality";
import type { QuestionType, VariableOverrides } from "@/lib/variableOverrides";
import { ChecksFold } from "./ImportQualityChecks";
import ReadFileAgainButton from "./ReadFileAgainButton";

export type ImportQualityTable = {
  /** Cached workbook preview could not be reconciled with its authoritative sheet. */
  previewError?: string | null;
  id: string;
  /** The file this table belongs to, for saving per-variable overrides against. */
  documentId: string;
  documentName: string;
  label: string | null;
  tableIndex: number;
  headers: string[];
  rows: Record<string, CellValue>[];
  /** Worked out ahead of time (and cached) for raw files, which are too large to pass around. */
  quality?: TableQuality;
  ingestionType: "raw" | "aggregated";
  /** Set when the file was too wide to store whole and only usable variables were kept. */
  trimmed?: { total: number; kept: number } | null;
  /**
   * True once `quality` covers every variable in the original file, not just
   * the kept subset (built from the uncapped variable dictionary, the same
   * one the cross tab tool reads from). False, or absent, means `quality`
   * only describes the kept subset named in `trimmed`.
   */
  fullyCovered?: boolean;
  /** Skip instructions read off a confirmed questionnaire. */
  stated?: StatedRouting[];
  /** multi/grid/battery membership from the variable dictionary; absent means a single-mention question. */
  questionTypeByVariable?: Record<string, QuestionType>;
  questionTypeError?: string | null;
  /** The researcher's corrections to what import inferred, keyed by variable name. */
  overrides?: VariableOverrides;
  /**
   * For an SPSS/Stata/SAS file whose stored table is keyed by each variable's display label
   * (see _build_headers in parse-stats-file.py), not its canonical name: maps that displayed
   * header back to the name every correction, and every downstream calculation, actually
   * addresses it by. Absent (or missing an entry) means the header already is the canonical
   * name, true for CSV/Excel files and for any file whose full coverage was already computed
   * from the dictionary (fullyCovered), where quality.variableDetails is canonically keyed already.
   */
  canonicalNameByHeader?: Record<string, string>;
  /** Every real canonical variable name in this document's dictionary (IMP-003): lets the
   * client refuse to fall back to a header's own text as a canonical name when that text
   * happens to collide with a DIFFERENT variable's actual name, rather than trust the
   * fallback is always safe. */
  claimedCanonicalNames?: string[];
  /** Codex round 3, "prevent affected identifiers from silently entering inconsistent
   * calculations": id-like columns whose Excel cell format this pipeline could not
   * faithfully reproduce on the calculation side (parseTable.ts's
   * unsupportedIdentifierColumns, recorded via the unsupported_identifier_format trace
   * event). Non-empty means affected cells in these columns are blanked out in both
   * preview and calculations (parseTable.ts/_apply_zero_padded_id_formats both null the
   * value rather than guess at a format neither side can reproduce identically) - this
   * is a block with a recovery instruction, not a warning over a value that still works. */
  unsupportedIdentifierColumns?: string[];
  /** How the file was read (document_tables.read_provenance): a CSV/TSV read as Windows-1252 or UTF-16
   * text rather than UTF-8, and the variables holding calendar dates (stored as ISO dates). */
  readNotes?: { encoding: string | null; dateColumns: string[]; naCodeColumns?: string[]; titleRows?: string[] };
  /** IMP-015: variables whose label sheets disagree about what a code (or the variable) means.
   * The engine shows such codes with every competing label instead of choosing one. */
  labelConflicts?: { variable: string; kind: "variable_label" | "value_label"; value?: string | number }[];
  /** IMP-015: label-sheet variable names that match no data column. */
  unmatchedLabelVariables?: string[];
};

/** IMP-015: the alert for a workbook's conflicting label definitions. Conflicts are shown, never
 * silently resolved. Label-sheet names matching no data column are the "Value labels" row of the
 * checks table (ValueLabelsRow). Renders nothing when there is no conflict. */
export function LabelDiagnosticsNotice({
  conflicts,
}: {
  conflicts: { variable: string; kind: "variable_label" | "value_label"; value?: string | number }[];
}) {
  if (conflicts.length === 0) return null;
  const vars = Array.from(new Set(conflicts.map((c) => c.variable)));
  return (
    <p role="alert" data-testid="label-conflicts" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <strong>Conflicting labels.</strong> This workbook&rsquo;s label sheets disagree about what{" "}
      {vars.length === 1 ? "the variable " : "the variables "}
      <strong>{vars.slice(0, 8).map((v) => `"${v}"`).join(", ")}</strong>
      {vars.length > 8 ? ` and ${vars.length - 8} more` : ""}{" "}
      {"mean. No label was chosen: each conflicting code is shown with all of its labels, for example "}
      <em>1 [conflicting labels: &ldquo;Yes&rdquo; / &ldquo;No&rdquo;]</em>, in every table, chart and export, and the
      counts are unaffected. <strong>To resolve:</strong> correct the label sheets in the workbook so each code has one
      meaning, then re-upload the file. Tables or findings calculated before this check may still show one of
      the labels; recalculate them after re-uploading.
    </p>
  );
}

/**
 * The label sheets in the checks table (Grant, 2026-10-22: the long sentence listing names was hard to
 * read). Counts come from the same lists the engine reports; every unmatched name is in the fold, none
 * dropped. It is a note, not a check: it does not change the table's status or the tab's count.
 */
export function ValueLabelsRow({
  conflicts,
  unmatched,
}: {
  conflicts: { variable: string; kind: "variable_label" | "value_label"; value?: string | number }[];
  unmatched: string[];
}) {
  if (conflicts.length === 0 && unmatched.length === 0) return null;
  const conflicting = new Set(conflicts.map((c) => c.variable)).size;
  return (
    <tr className="border-b border-border last:border-0" data-testid="value-labels-row">
      <td className="px-3 py-2 align-top font-medium text-foreground">Value labels</td>
      <td className="px-3 py-2 align-top text-muted">
        {conflicting > 0 && <p>{`${conflicting} ${conflicting === 1 ? "variable has" : "variables have"} conflicting labels (see the note above).`}</p>}
        {unmatched.length > 0 && (
          <details data-testid="unmatched-label-variables">
            <summary className="cursor-pointer">
              {`${unmatched.length} ${unmatched.length === 1 ? "variable" : "variables"} in the label sheets ${unmatched.length === 1 ? "is" : "are"} not in the data, so ${unmatched.length === 1 ? "its labels are" : "their labels are"} not applied. Check for a renamed or misspelt column.`}
            </summary>
            <ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-5">
              {unmatched.map((v) => (
                <li key={v} className="break-all">
                  {v}
                </li>
              ))}
            </ul>
          </details>
        )}
      </td>
      <td className="px-3 py-2 text-right align-top">
        <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">Note</span>
      </td>
    </tr>
  );
}

const ENCODING_NAME: Record<string, string> = { "windows-1252": "Windows-1252 (Western European)", "utf-16": "UTF-16" };

/** How the file was read, where that is worth knowing before trusting text and dates. */
function ReadNotes({ notes }: { notes?: { encoding: string | null; dateColumns: string[]; naCodeColumns?: string[]; titleRows?: string[] } }) {
  if (!notes) return null;
  const legacy = notes.encoding && notes.encoding !== "utf-8" ? ENCODING_NAME[notes.encoding] ?? notes.encoding : null;
  const dates = notes.dateColumns;
  const naCodes = notes.naCodeColumns ?? [];
  const titles = notes.titleRows ?? [];
  if (!legacy && dates.length === 0 && naCodes.length === 0 && titles.length === 0) return null;
  return (
    <div data-testid="read-notes" className="space-y-1 rounded-lg border border-border bg-slate-50 px-3 py-2 text-xs text-muted">
      {legacy && (
        <p data-testid="read-encoding">
          This file is not UTF-8 text, so it was read as <strong>{legacy}</strong>. If accented or non-Latin letters look
          wrong in the preview, save the file as &ldquo;CSV UTF-8&rdquo; and upload it again.
        </p>
      )}
      {dates.length > 0 && (
        <p data-testid="read-dates">
          {dates.length === 1 ? "The variable " : "The variables "}
          <strong>{dates.slice(0, 6).map((c) => `"${c}"`).join(", ")}</strong>
          {dates.length > 6 ? ` and ${dates.length - 6} more` : ""}{" "}
          {dates.length === 1 ? "holds" : "hold"} dates, read as calendar dates (year-month-day, with the time of day where
          the cell has one) in the preview and in every calculation. No time zone is applied.
        </p>
      )}
      {titles.length > 0 && (
        <p data-testid="read-title-rows">
          {titles.length === 1 ? "The first row" : `The first ${titles.length} rows`} above the header
          {titles.some((t) => t) ? <> (<strong>{titles.filter((t) => t).slice(0, 3).map((t) => `"${t.slice(0, 80)}"`).join(", ")}</strong>)</> : ""}{" "}
          {titles.length === 1 ? "was read as a title and left out" : "were read as a title and left out"}: the header is the
          first row holding two or more names. If a row left out holds data, delete the title rows from the file and upload it again.
        </p>
      )}
      {naCodes.length > 0 && (
        <p data-testid="read-na-codes" className="text-amber-800">
          {naCodes.length === 1 ? "The variable " : "The variables "}
          <strong>{naCodes.slice(0, 6).map((c) => `"${c}"`).join(", ")}</strong>
          {naCodes.length > 6 ? ` and ${naCodes.length - 6} more` : ""}{" "}
          {naCodes.length === 1 ? "holds" : "hold"} short codes, and cells reading &ldquo;NA&rdquo; were read as missing. If
          &ldquo;NA&rdquo; is a code here (Namibia&rsquo;s country code, for example), those cases are not counted: change
          the cells to another code, or to &ldquo;Namibia&rdquo;, and upload the file again.
        </p>
      )}
    </div>
  );
}

/** A withheld stored preview (importPreviewIdentity.ts), with "Read the file again" where `reread` names the file. */
export function ImportPreviewRecovery({ error, reread }: { error: string; reread?: { runId: string; documentId: string } }) {
  return (
    <div role="alert" data-testid="import-preview-recovery" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <p>{error}</p>
      {reread && <ReadFileAgainButton runId={reread.runId} documentId={reread.documentId} />}
    </div>
  );
}

export const typeLabel: Record<VariableType, string> = {
  categorical: "Categorical",
  discrete: "Discrete scale",
  continuous: "Continuous",
};

export const typeHelp: Record<VariableType, string> = {
  categorical: "Text values, or numbers with only two distinct values",
  discrete:
    "Whole numbers with 3 to 10 distinct values: rating scales, counts, coded answers (ordinal or interval)",
  continuous: "Decimals, or whole numbers with more than 10 distinct values",
};

const statusLabel: Record<QualityStatus, string> = {
  pass: "Pass",
  warn: "Check",
  fail: "Problem",
};

const statusClass: Record<QualityStatus, string> = {
  pass: "bg-success-light text-success",
  warn: "bg-amber-50 text-amber-700",
  fail: "bg-rose-50 text-rose-700",
};

export function StatusPill({ status }: { status: QualityStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${statusClass[status]}`}
    >
      {statusLabel[status]}
    </span>
  );
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2">
      <div className="text-lg font-semibold text-foreground">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

/**
 * Data quality for what was imported, one block per table. Everything here
 * is counted straight from the stored rows, nothing is judged by a model,
 * and nothing is blocked: a Problem flag is a prompt to look, not a gate.
 */
/**
 * A table's heading. Inside a selected source's tab (withinSource) the file's name is already in the
 * header above (Grant, 2026-10-20), so only the table's own name is given, and none for a file's only
 * unnamed table.
 */
export function tableHeading(table: ImportQualityTable, withinSource: boolean): string | null {
  const part = table.label ? table.label : table.tableIndex > 0 ? `table ${table.tableIndex + 1}` : null;
  if (withinSource) return part ? part.charAt(0).toUpperCase() + part.slice(1) : null;
  return `${table.documentName}${part ? `: ${part}` : ""}`;
}

export default function ImportQualityPanel({
  tables,
  hasReportOnly,
  withinSource = false,
}: {
  tables: ImportQualityTable[];
  hasReportOnly: boolean;
  /** Shown in a selected source's tab: no file name and no box of its own. */
  withinSource?: boolean;
}) {
  if (tables.length === 0) {
    return (
      <p className="text-sm text-muted">
        {hasReportOnly
          ? "No data tables were supplied with this run, so there is no import quality to report. Findings from the report are judged on its own wording only."
          : "Nothing imported yet. Upload a table or data file and its quality checks appear here."}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-xs text-muted">
        Counted directly from each imported table, not judged by a model. A
        Check or Problem flag is a prompt to look before trusting comparisons
        built on the data, it does not block anything. Empty cells, blanks and
        entries such as NA or N/A count as missing.
      </p>
      {tables.map((table) => {
        if (table.previewError) return <ImportPreviewRecovery key={table.id} error={table.previewError} />;
        const q =
          table.quality ??
          computeTableQuality(
            table.headers,
            table.rows,
            table.ingestionType,
            table.stated ?? [],
          );
        const title = tableHeading(table, withinSource);
        const caseLabel = q.kind === "raw" ? "Cases" : "Rows";
        const variableLabel = q.kind === "raw" ? "Variables" : "Columns";
        return (
          <div
            key={table.id}
            data-testid="import-quality-table"
            className={withinSource ? "space-y-3" : "space-y-3 rounded-xl border border-border bg-white p-4"}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                {title && (
                  <div className="truncate text-sm font-medium text-foreground" title={title}>
                    {title}
                  </div>
                )}
                {!withinSource && <div className="text-xs text-muted">{q.kind === "raw" ? "Case-level data" : "Aggregated table"}</div>}
                {withinSource && !title && <div className="text-xs font-medium text-foreground">Overall</div>}
              </div>
              <StatusPill status={q.status} />
            </div>

            {table.trimmed && !table.fullyCovered ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                The file holds {table.trimmed.total.toLocaleString()} variables in total. It is too wide to store whole, so
                only {table.trimmed.kept.toLocaleString()} were kept for this preview and these checks: those with
                enough answers to compare, in file order. The cross tab tool still reads every variable in the
                original file, so tables are not limited to this subset. The figures below, including missing
                values, describe the kept variables only.
              </p>
            ) : table.trimmed ? (
              <p className="rounded-lg border border-border bg-slate-50 px-3 py-2 text-xs text-muted">
                The file holds {table.trimmed.total.toLocaleString()} variables. It is too wide to store the case-level
                rows for all of them, so only {table.trimmed.kept.toLocaleString()} are kept for the row preview and
                for building tables directly from stored rows; the cross tab tool reads every variable from the
                original file regardless. The checks below, and the variable list, now cover every variable in the
                file, read the same uncapped way the cross tab tool does, with one exception: routing-pattern
                detection (spotting a skipped question) still only runs on the {table.trimmed.kept.toLocaleString()}{" "}
                kept variables, since that check needs the full row-by-row data in memory, not summaries.
              </p>
            ) : null}
            {/* Conflicting labels stay an alert above; label-sheet names with no data column are a
                "Value labels" row in the checks table, with the full list in a fold (Grant, 2026-10-22). */}
            <LabelDiagnosticsNotice conflicts={table.labelConflicts ?? []} />
            {table.unsupportedIdentifierColumns && table.unsupportedIdentifierColumns.length > 0 ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {table.unsupportedIdentifierColumns.length === 1 ? "The identifier column " : "The identifier columns "}
                <strong>{table.unsupportedIdentifierColumns.map((c) => `"${c}"`).join(", ")}</strong>{" "}
                {table.unsupportedIdentifierColumns.length === 1 ? "uses" : "use"} a number format this tool
                can&rsquo;t reproduce exactly from the file (for example, thousands separators), so{" "}
                {table.unsupportedIdentifierColumns.length === 1 ? "its affected values are" : "their affected values are"}{" "}
                blanked out here and in every calculation, rather than risk a value neither the preview nor a
                calculation can confirm is the same identifier. <strong>To recover:</strong> in the source file,
                clear this column&rsquo;s custom number format (right-click the column → Format Cells → either
                &ldquo;Text&rdquo; or &ldquo;Number&rdquo; with no thousands separator), then re-upload the file.
                Cases blanked out this way won&rsquo;t match or group correctly until that&rsquo;s done.
              </p>
            ) : null}
            <ReadNotes notes={table.readNotes} />
            <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
              <Stat value={q.cases.toLocaleString()} label={caseLabel} />
              <Stat
                value={q.variables.toLocaleString()}
                label={
                  table.trimmed
                    ? `${variableLabel} kept (of ${table.trimmed.total.toLocaleString()})`
                    : variableLabel
                }
              />
              <Stat
                value={q.missingCells.toLocaleString()}
                label={
                  q.routedVariables > 0
                    ? "Missing values (includes planned skips)"
                    : "Missing values"
                }
              />
              <Stat
                value={`${q.missingPct}%`}
                label={
                  q.routedVariables > 0
                    ? `Of all cells empty (${q.unexplainedMissingPct}% once ${q.routedVariables} routed question${q.routedVariables === 1 ? "" : "s"} are set aside)`
                    : "Of all cells empty"
                }
              />
            </div>

            <div>
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
                Variable types
              </div>
              <div className="grid grid-cols-3 gap-2 sm:max-w-xl">
                {(["categorical", "discrete", "continuous"] as const).map(
                  (type) => (
                    <div
                      key={type}
                      title={typeHelp[type]}
                      className="rounded-lg border border-border bg-white px-3 py-2"
                    >
                      <div className="text-lg font-semibold text-foreground">
                        {q.typeCounts[type]}
                      </div>
                      <div className="text-xs text-muted">
                        {typeLabel[type]}
                      </div>
                    </div>
                  ),
                )}
              </div>
              <p className="mt-1.5 text-xs text-muted">
                Inferred from the values, since the file does not state how each
                question was measured. Hover a type for the rule used.
              </p>
            </div>

            <ChecksFold statuses={q.checks.map((check) => check.status)}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead>
                  <tr className="border-b border-border bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    <th className="w-56 px-3 py-2">Check</th>
                    <th className="px-3 py-2">Result</th>
                    <th className="w-24 px-3 py-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {q.checks.map((check) => (
                    <tr
                      key={check.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2 align-middle font-medium text-foreground">
                        {check.label}
                      </td>
                      <td className="px-3 py-2 align-middle text-muted">
                        {check.detail}
                      </td>
                      <td className="px-3 py-2 text-right align-middle">
                        <StatusPill status={check.status} />
                      </td>
                    </tr>
                  ))}
                  <ValueLabelsRow conflicts={table.labelConflicts ?? []} unmatched={table.unmatchedLabelVariables ?? []} />
                </tbody>
              </table>
            </div>
            </ChecksFold>

          </div>
        );
      })}
    </div>
  );
}
