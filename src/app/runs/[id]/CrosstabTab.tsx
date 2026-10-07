"use client";

import { useMemo, useState } from "react";
import type { CodingAnalysisView } from "@/lib/codingAnalysis";
import {
  cooccurrence,
  themesByAttribute,
  usableAttributes,
} from "@/lib/qualCrosstab";

const th = "px-3 py-2 text-left text-[11px] font-semibold text-muted";
const td = "px-3 py-2 align-top text-xs text-foreground";
const select =
  "rounded-md border border-border bg-white px-2 py-1 text-xs text-foreground";

const pct = (n: number | null) =>
  n === null ? "n/a" : `${Math.round(n * 100)}%`;

export default function CrosstabTab({ view }: { view: CodingAnalysisView }) {
  const codes = useMemo(
    () => view.codes.map((c) => ({ id: c.id, name: c.name })),
    [view.codes],
  );
  const attributes = useMemo(
    () => usableAttributes(view.respondents),
    [view.respondents],
  );
  const [mode, setMode] = useState<"attribute" | "together">(
    attributes.length > 0 ? "attribute" : "together",
  );
  const [attribute, setAttribute] = useState(attributes[0] ?? "");

  const byAttr = useMemo(
    () =>
      mode === "attribute" && attribute
        ? themesByAttribute(view.respondents, codes, attribute)
        : null,
    [mode, attribute, view.respondents, codes],
  );
  const together = useMemo(
    () =>
      mode === "together"
        ? cooccurrence(
            view.respondents,
            codes,
            view.verbatims.map((v) => v.codeIds),
          )
        : null,
    [mode, view.respondents, view.verbatims, codes],
  );

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted">
        Counts only, each against its base. No significance tests: with
        interview-sized samples a p-value would claim more than the data can
        support, so small groups are flagged instead.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={select}
          value={mode}
          onChange={(e) => setMode(e.target.value as "attribute" | "together")}
          aria-label="Cross-tab type"
        >
          <option value="attribute" disabled={attributes.length === 0}>
            Themes by a respondent attribute
          </option>
          <option value="together">Which themes appear together</option>
        </select>
        {mode === "attribute" && attributes.length > 0 && (
          <select
            className={select}
            value={attribute}
            onChange={(e) => setAttribute(e.target.value)}
            aria-label="Attribute"
          >
            {attributes.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        )}
      </div>

      {mode === "attribute" && attributes.length === 0 && (
        <p className="text-[11px] text-muted">
          No usable respondent attributes. They come from profile lines in the
          transcript (age group, sex, income and so on) or from a file holding
          several sessions. Map the respondents to a survey on the Respondents
          tab to bring survey answers in as attributes.
        </p>
      )}

      {byAttr && (
        <div className="space-y-1">
          <div className="overflow-x-auto rounded-lg border border-border bg-white">
            <table className="w-full min-w-[480px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Theme</th>
                  {byAttr.groups.map((g) => (
                    <th key={g.value} className={th}>
                      {g.value}
                      <span className="block font-normal">
                        {g.base} respondent{g.base === 1 ? "" : "s"}
                        {g.small ? " (small group)" : ""}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {byAttr.rows.map((r) => (
                  <tr key={r.codeId}>
                    <td className={`${td} font-medium`}>{r.codeName}</td>
                    {r.cells.map((c, i) => (
                      <td
                        key={i}
                        className={td}
                        title={`${c.turns} coded turn${c.turns === 1 ? "" : "s"}`}
                      >
                        {c.withTheme} of {c.base} ({pct(c.share)})
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted">
            Respondents who voiced each theme, out of the respondents in that
            group.{" "}
            {byAttr.unknown > 0 &&
              `${byAttr.unknown} respondent${byAttr.unknown === 1 ? " has" : "s have"} no value for ${byAttr.attribute} and are left out. `}
            Groups under 5 are shown but should be read as leads, not
            differences.
          </p>
        </div>
      )}

      {together && (
        <div className="space-y-1">
          <div className="overflow-x-auto rounded-lg border border-border bg-white">
            <table className="w-full min-w-[480px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Theme</th>
                  {together.codes.map((c, i) => (
                    <th key={c.id} className={th} title={c.name}>
                      {i + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {together.codes.map((c, i) => (
                  <tr key={c.id}>
                    <td className={`${td} font-medium`}>
                      {i + 1}. {c.name}
                    </td>
                    {together.codes.map((o, j) => (
                      <td
                        key={o.id}
                        className={`${td} ${i === j ? "bg-slate-50 font-semibold" : ""}`}
                        title={`${together.turnPairs[i][j]} turn${together.turnPairs[i][j] === 1 ? "" : "s"}`}
                      >
                        {together.pairs[i][j]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted">
            Respondents who voiced both themes, out of {together.respondents}.
            The shaded diagonal is how many voiced each theme at all. Hover a
            cell for the number of single turns carrying both, which is a
            sharper sign that two themes belong together in what people said.
          </p>
        </div>
      )}
    </div>
  );
}
