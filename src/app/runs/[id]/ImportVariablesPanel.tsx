"use client";

import { ImportPreviewRecovery } from "./ImportQualityPanel";
import { useMemo, useRef, useState } from "react";
import { computeTableQuality, type VariableType } from "@/lib/dataQuality";
import {
  QUESTION_TYPE_LABEL,
  type QuestionType,
} from "@/lib/variableOverrideTypes";
import { saveVariableOverrideAction } from "@/lib/variableOverrideActions";
import {
  typeLabel,
  typeHelp,
  type ImportQualityTable,
} from "./ImportQualityPanel";

const QUESTION_TYPES: QuestionType[] = ["single", "multi", "grid", "battery"];
const VARIABLE_TYPES: VariableType[] = ["categorical", "discrete", "continuous"];

const selectClass =
  "rounded-md border border-border bg-white px-1 py-0.5 text-[11px] text-foreground";

type RowOverride = { type?: VariableType; questionType?: QuestionType };

/**
 * IMP-005 (P2a repair): the saved, document-scoped overrides as the current props describe them,
 * keyed `${documentId}:${canonicalName}` - the same key shape local edits use. Keys come straight
 * from loadVariableOverrides (documents.variable_overrides), which is always keyed by the
 * dictionary's canonical name, so no header-to-name resolution happens here.
 */
export function savedOverridesFromTables(
  tables: Pick<ImportQualityTable, "documentId" | "overrides">[],
): Record<string, RowOverride> {
  const saved: Record<string, RowOverride> = {};
  for (const table of tables) {
    for (const [name, o] of Object.entries(table.overrides ?? {})) {
      saved[`${table.documentId}:${name}`] = o;
    }
  }
  return saved;
}

/**
 * IMP-005 (P2a repair): what one variable currently shows. A correction the researcher made in
 * this mounted session wins - saving it deliberately does not refresh the page's props (see
 * saveVariableOverrideAction), so older props must never overwrite it, and an in-flight or failed
 * save is still the researcher's newest intent. Otherwise the saved override from the CURRENT
 * props is shown. An explicit local entry with no fields (a cleared correction) wins too, so a
 * clear is never undone by the stale saved value it just removed.
 */
export function effectiveRowOverride(
  localEdits: Record<string, RowOverride>,
  saved: Record<string, RowOverride>,
  key: string,
): RowOverride | undefined {
  return key in localEdits ? localEdits[key] : saved[key];
}

/**
 * The variable-by-variable listings that used to sit inside the data
 * quality report: every variable in the file, and the ones worth looking
 * at. Split out so the quality checks read as their own short report, and
 * so each variable's data type and question type can be corrected here,
 * next to the row it describes, rather than only shown as read-only.
 */
export default function ImportVariablesPanel({
  runId,
  tables,
}: {
  runId: string;
  tables: ImportQualityTable[];
}) {
  // IMP-005 (P2a repair): this used to copy table.overrides into state once, at first mount.
  // The Import detail pane keeps this same component instance when the researcher selects a
  // different file (and after a reload it first auto-selects whichever file is listed first), so
  // the saved corrections of every file selected later were never shown: a saved "continuous"
  // displayed as the inferred "discrete" while calculations correctly used "continuous". Saved
  // overrides are now derived from the current props on every render, and state holds only the
  // researcher's own edits from this mounted session (see effectiveRowOverride).
  const saved = useMemo(() => savedOverridesFromTables(tables), [tables]);
  const [localEdits, setLocalEdits] = useState<Record<string, RowOverride>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Per-key request sequence: only the newest save for a key may clear its pending state or
  // report its error, so an earlier response arriving late never overrides newer intent.
  const latestRequest = useRef<Record<string, number>>({});

  function save(
    documentId: string,
    variableName: string,
    patch: { type?: VariableType | null; questionType?: QuestionType | null },
  ) {
    const key = `${documentId}:${variableName}`;
    setLocalEdits((prev) => {
      // Starts from what is currently shown (a local edit, else the saved override), so changing
      // one field never drops the other field's saved correction.
      const next = { ...(effectiveRowOverride(prev, saved, key) ?? {}) };
      if (patch.type === null) delete next.type;
      else if (patch.type !== undefined) next.type = patch.type;
      if (patch.questionType === null) delete next.questionType;
      else if (patch.questionType !== undefined) next.questionType = patch.questionType;
      return { ...prev, [key]: next };
    });
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setPending((prev) => new Set(prev).add(key));
    const request = (latestRequest.current[key] ?? 0) + 1;
    latestRequest.current[key] = request;
    void saveVariableOverrideAction(runId, documentId, variableName, patch).then((r) => {
      if (latestRequest.current[key] !== request) return;
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      if (!r.ok) setErrors((prev) => ({ ...prev, [key]: r.error }));
    });
  }

  if (tables.length === 0) return null;

  return (
    <div className="space-y-5">
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
        const title = `${table.documentName}${table.label ? `: ${table.label}` : table.tableIndex > 0 ? `: table ${table.tableIndex + 1}` : ""}`;

        // table.headers (and so q.variableDetails[].name, for an SPSS/Stata/SAS file not already
        // canonically keyed via fullyCovered) can be each variable's display LABEL rather than its
        // canonical name. Every saved override, and every place that reads one back, has to agree
        // on which one it's keyed by - the dictionary's canonical name - or a correction saved here
        // reaches nothing downstream, and an existing saved one never shows as selected either.
        // Returns null when a header cannot be safely resolved to a canonical name at all
        // (IMP-003): an ambiguous label shared by two different variables, OR a label (or
        // any other unmapped header) that happens to read exactly like some OTHER real
        // variable's canonical name, where falling back to the raw header text would
        // silently address that other variable instead. Callers must disable corrections
        // for a row whose name resolves to null, never guess by using the header as-is.
        function canonicalName(header: string): string | null {
          const mapped = table.canonicalNameByHeader?.[header];
          if (mapped) return mapped;
          if (table.claimedCanonicalNames?.includes(header)) return null;
          return header;
        }
        function effectiveType(header: string, inferred: VariableType): VariableType {
          const name = canonicalName(header);
          return name ? effectiveRowOverride(localEdits, saved, `${table.documentId}:${name}`)?.type ?? inferred : inferred;
        }
        function effectiveQuestionType(header: string): QuestionType {
          const name = canonicalName(header);
          if (!name) return "single";
          return (
            effectiveRowOverride(localEdits, saved, `${table.documentId}:${name}`)?.questionType ??
            table.questionTypeByVariable?.[name] ??
            "single"
          );
        }

        return (
          <div
            key={table.id}
            className="space-y-3 rounded-xl border border-border bg-white p-4"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground" title={title}>
                {title}
              </div>
              <div className="text-xs text-muted">
                Variables, as read at import. Change the type or question type below if import got one wrong; your
                change is kept and used everywhere this variable is classified.
              </div>
            </div>

            <details className="text-xs" open>
              <summary className="cursor-pointer select-none font-medium text-muted">
                All variables ({q.variableDetails.length})
              </summary>
              <div className="mt-2 max-h-96 overflow-auto">
                <table className="w-full min-w-[620px] text-left">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wide text-muted">
                      <th className="py-1 pr-3">Variable</th>
                      <th className="py-1 pr-3">Type</th>
                      <th className="py-1 pr-3">Question type</th>
                      <th className="py-1 pr-3 text-right">Distinct values</th>
                      <th className="py-1 text-right">Missing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.variableDetails.map((v) => {
                      const name = canonicalName(v.name);
                      // IMP-003: a header that cannot be safely resolved (ambiguous, or
                      // coincidentally identical to a different variable's real name) must
                      // not accept corrections at all - entering one here, keyed by a guess,
                      // would silently misaddress whichever variable actually owns that key.
                      const unresolved = name === null;
                      const key = name ? `${table.documentId}:${name}` : null;
                      const type = effectiveType(v.name, v.type);
                      const questionType = effectiveQuestionType(v.name);
                      return (
                        <tr key={v.name} className="border-b border-border last:border-0">
                          <td className="max-w-xs truncate py-1 pr-3 text-foreground" title={v.name}>
                            {v.name || "(blank)"}
                          </td>
                          <td className="py-1 pr-3">
                            <select
                              aria-label={`Data type: ${v.name}`}
                              className={selectClass}
                              title={unresolved ? "This column's name is ambiguous in this file, so its type can't be corrected safely." : typeHelp[type]}
                              value={type}
                              disabled={unresolved || pending.has(key ?? "")}
                              onChange={(e) =>
                                name && save(table.documentId, name, { type: e.target.value as VariableType })
                              }
                            >
                              {VARIABLE_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {typeLabel[t]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1 pr-3">
                            <select
                              aria-label={`Question type: ${v.name}`}
                              className={selectClass}
                              title={unresolved ? "This column's name is ambiguous in this file, so its question type can't be corrected safely." : undefined}
                              value={questionType}
                              disabled={unresolved || pending.has(key ?? "")}
                              onChange={(e) =>
                                name && save(table.documentId, name, { questionType: e.target.value as QuestionType })
                              }
                            >
                              {QUESTION_TYPES.map((qt) => (
                                <option key={qt} value={qt}>
                                  {QUESTION_TYPE_LABEL[qt]}
                                </option>
                              ))}
                            </select>
                            {unresolved && (
                              <div className="mt-0.5 text-[10px] text-danger">Ambiguous column name - corrections disabled.</div>
                            )}
                            {key && errors[key] && (
                              <div className="mt-0.5 text-[10px] text-danger">{errors[key]}</div>
                            )}
                          </td>
                          <td className="py-1 pr-3 text-right">{v.distinct}</td>
                          <td className="py-1 text-right">
                            {v.missing} ({v.missingPct}%)
                          </td>
                        </tr>
                      );
                    })}
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
                        <th className="py-1 pr-3 text-right">Distinct values</th>
                        <th className="py-1">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.worstVariables.map((v) => (
                        <tr key={v.name} className="border-b border-border last:border-0">
                          <td className="max-w-xs truncate py-1 pr-3 text-foreground" title={v.name}>
                            {v.name || "(blank)"}
                          </td>
                          <td className="py-1 pr-3 text-right">
                            {v.missing} ({v.missingPct}%)
                          </td>
                          <td className="py-1 pr-3 text-right">{v.distinct}</td>
                          <td className="py-1 text-muted">
                            {[
                              v.routedBy
                                ? v.routedSource === "questionnaire"
                                  ? `skip logic from questionnaire (gate: ${v.routedBy}), ${v.missingAsked ?? 0} of ${v.askedCount ?? 0} asked are empty`
                                  : `routed by ${v.routedBy}`
                                : null,
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
