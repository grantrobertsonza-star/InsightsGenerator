import {
  computeTableQuality,
  type VariableType,
  type CellValue,
  type QualityStatus,
} from "@/lib/dataQuality";

export type ImportQualityTable = {
  id: string;
  documentName: string;
  label: string | null;
  tableIndex: number;
  headers: string[];
  rows: Record<string, CellValue>[];
  ingestionType: "raw" | "aggregated";
};

const typeLabel: Record<VariableType, string> = {
  categorical: "Categorical",
  discrete: "Discrete scale",
  continuous: "Continuous",
};

const typeHelp: Record<VariableType, string> = {
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

function StatusPill({ status }: { status: QualityStatus }) {
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
export default function ImportQualityPanel({
  tables,
  hasReportOnly,
}: {
  tables: ImportQualityTable[];
  hasReportOnly: boolean;
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
        const q = computeTableQuality(
          table.headers,
          table.rows,
          table.ingestionType,
        );
        const title = `${table.documentName}${table.label ? `: ${table.label}` : table.tableIndex > 0 ? `: table ${table.tableIndex + 1}` : ""}`;
        const caseLabel = q.kind === "raw" ? "Cases" : "Rows";
        const variableLabel = q.kind === "raw" ? "Variables" : "Columns";
        return (
          <div
            key={table.id}
            className="space-y-3 rounded-xl border border-border bg-white p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div
                  className="truncate text-sm font-medium text-foreground"
                  title={title}
                >
                  {title}
                </div>
                <div className="text-xs text-muted">
                  {q.kind === "raw" ? "Case-level data" : "Aggregated table"}
                </div>
              </div>
              <StatusPill status={q.status} />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat value={q.cases.toLocaleString()} label={caseLabel} />
              <Stat
                value={q.variables.toLocaleString()}
                label={variableLabel}
              />
              <Stat
                value={q.missingCells.toLocaleString()}
                label="Missing values"
              />
              <Stat value={`${q.missingPct}%`} label="Of all cells empty" />
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
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
                </tbody>
              </table>
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

            <details className="text-xs">
              <summary className="cursor-pointer select-none font-medium text-muted">
                All variables ({q.variableDetails.length})
              </summary>
              <div className="mt-2 max-h-80 overflow-auto">
                <table className="w-full min-w-[460px] text-left">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wide text-muted">
                      <th className="py-1 pr-3">Variable</th>
                      <th className="py-1 pr-3">Type</th>
                      <th className="py-1 pr-3 text-right">Distinct values</th>
                      <th className="py-1 text-right">Missing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.variableDetails.map((v) => (
                      <tr
                        key={v.name}
                        className="border-b border-border last:border-0"
                      >
                        <td
                          className="max-w-xs truncate py-1 pr-3 text-foreground"
                          title={v.name}
                        >
                          {v.name || "(blank)"}
                        </td>
                        <td className="py-1 pr-3" title={typeHelp[v.type]}>
                          {typeLabel[v.type]}
                        </td>
                        <td className="py-1 pr-3 text-right">{v.distinct}</td>
                        <td className="py-1 text-right">
                          {v.missing} ({v.missingPct}%)
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            {q.worstVariables.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer select-none font-medium text-muted">
                  Variables to look at ({q.worstVariables.length})
                </summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[420px] text-left">
                    <thead>
                      <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wide text-muted">
                        <th className="py-1 pr-3">Variable</th>
                        <th className="py-1 pr-3 text-right">Missing</th>
                        <th className="py-1 pr-3 text-right">
                          Distinct values
                        </th>
                        <th className="py-1">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.worstVariables.map((v) => (
                        <tr
                          key={v.name}
                          className="border-b border-border last:border-0"
                        >
                          <td
                            className="max-w-xs truncate py-1 pr-3 text-foreground"
                            title={v.name}
                          >
                            {v.name || "(blank)"}
                          </td>
                          <td className="py-1 pr-3 text-right">
                            {v.missing} ({v.missingPct}%)
                          </td>
                          <td className="py-1 pr-3 text-right">{v.distinct}</td>
                          <td className="py-1 text-muted">
                            {[
                              v.constant ? "single value" : null,
                              v.unlabelled ? "no label" : null,
                            ]
                              .filter(Boolean)
                              .join(", ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
