"use client";

import { useEffect, useId, useState } from "react";
import { loadCategoriesAction } from "@/lib/crosstabActions";
import type { CrosstabFilter, VariableDictionary } from "@/lib/parseStatsFile";

/** Plain-words description of one filter, for chips and table titles. */
export function filterText(f: CrosstabFilter, dict: VariableDictionary | null): string {
  const label = dict?.variables.find((v) => v.name === f.variable)?.label ?? f.variable;
  if (f.op === "between") {
    if (f.min != null && f.max != null) return `${label} from ${f.min} to ${f.max}`;
    return f.min != null ? `${label} at least ${f.min}` : `${label} at most ${f.max}`;
  }
  return `${label} ${f.op === "notIn" ? "is not" : "is"} ${(f.values ?? []).join(" or ")}`;
}

/**
 * Filters for a table. All of them must hold. A labelled variable (gender, province, age band) is
 * filtered by ticking answers; a plain number (age in years) by a range. Used by the workspace and
 * by the Crosstabs window, so both ways of making a table filter the same way.
 */
export default function FilterBuilder({
  runId,
  documentId,
  dict,
  value,
  onChange,
}: {
  runId: string;
  documentId: string;
  dict: VariableDictionary;
  value: CrosstabFilter[];
  onChange: (f: CrosstabFilter[]) => void;
}) {
  const listId = useId();
  const [name, setName] = useState("");
  const info = dict.variables.find((v) => v.name === name);
  // Labelled answers (or few distinct values) are ticked; a plain number gets a range.
  const rangeKind = !!info && info.numeric && !info.labelled && info.nDistinct > 10;
  const [op, setOp] = useState<"in" | "notIn">("in");
  const [cats, setCats] = useState<string[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setTicked(new Set());
    setCats([]);
    setMin("");
    setMax("");
    setErr(null);
    if (!info || rangeKind) return;
    let live = true;
    loadCategoriesAction(runId, documentId, info.name).then((r) => {
      if (!live) return;
      if (r.ok) setCats(r.list.categories.map((c) => c.label));
      else setErr(r.error);
    });
    return () => {
      live = false;
    };
  }, [info, rangeKind, runId, documentId]);

  const lo = min.trim() === "" ? null : Number(min);
  const hi = max.trim() === "" ? null : Number(max);
  const rangeBad = rangeKind && ((lo === null && hi === null) || (lo !== null && Number.isNaN(lo)) || (hi !== null && Number.isNaN(hi)) || (lo !== null && hi !== null && lo > hi));
  const canAdd = !!info && (rangeKind ? !rangeBad : ticked.size > 0);

  function add() {
    if (!info || !canAdd) return;
    const f: CrosstabFilter = rangeKind ? { variable: info.name, op: "between", min: lo, max: hi } : { variable: info.name, op, values: [...ticked] };
    onChange([...value, f]);
    setName("");
  }

  return (
    <div className="space-y-2 text-xs">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {value.map((f, i) => (
            <li key={i} className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">
              <span>{filterText(f, dict)}</span>
              <button type="button" aria-label="Remove filter" onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-muted hover:text-danger">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          list={listId}
          value={name}
          onChange={(e) => setName(e.target.value.trim())}
          placeholder="Filter variable, e.g. age"
          className="w-44 rounded border border-border px-2 py-1"
          title="Choose a variable. All filters must hold at once."
        />
        <datalist id={listId}>
          {dict.variables.filter((v) => !v.weightLike).slice(0, 4000).map((v) => (
            <option key={v.name} value={v.name}>
              {v.label}
            </option>
          ))}
        </datalist>
        {info && rangeKind && (
          <>
            <span className="text-muted">from</span>
            <input value={min} onChange={(e) => setMin(e.target.value)} inputMode="decimal" placeholder="min" className="w-16 rounded border border-border px-2 py-1" />
            <span className="text-muted">to</span>
            <input value={max} onChange={(e) => setMax(e.target.value)} inputMode="decimal" placeholder="max" className="w-16 rounded border border-border px-2 py-1" />
            <span className="text-muted">(both ends included)</span>
          </>
        )}
        {info && !rangeKind && (
          <select value={op} onChange={(e) => setOp(e.target.value as "in" | "notIn")} className="rounded border border-border px-1 py-1">
            <option value="in">is one of</option>
            <option value="notIn">is not</option>
          </select>
        )}
        <button type="button" disabled={!canAdd} onClick={add} className="rounded border border-border px-2 py-1 font-medium disabled:opacity-50">
          Add filter
        </button>
      </div>
      {name && !info && <p className="text-muted">No variable with that name.</p>}
      {err && <p className="text-danger">{err}</p>}
      {info && !rangeKind && cats.length > 0 && (
        <ul className="max-h-32 space-y-0.5 overflow-y-auto rounded border border-border p-2">
          {cats.map((c) => (
            <li key={c}>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={ticked.has(c)}
                  onChange={() =>
                    setTicked((t) => {
                      const n = new Set(t);
                      if (n.has(c)) n.delete(c);
                      else n.add(c);
                      return n;
                    })
                  }
                />
                {c}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
