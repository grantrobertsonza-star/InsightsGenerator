"use client";

import { useMemo, useState } from "react";
import type { VariableGroup, VariableKind, VariableProfile } from "@/lib/variableProfile";

type Plan = { banner: string[]; stub: string[] };

const KIND_LABEL: Record<VariableKind, string> = {
  category: "Categories",
  flag: "Yes/no flag",
  scale: "Scale",
  number: "Number",
  text: "Text or ID",
};

const FILTERS: { id: "all" | VariableKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "category", label: "Categories" },
  { id: "flag", label: "Flags" },
  { id: "scale", label: "Scales" },
  { id: "number", label: "Numbers" },
  { id: "text", label: "Text and IDs" },
];

const PAGE = 150;

type Entry =
  | { kind: "variable"; variable: VariableProfile }
  | { kind: "group"; group: VariableGroup; members: VariableProfile[] };

function Toggle({
  label,
  state,
  onClick,
}: {
  label: string;
  state: "all" | "some" | "none";
  onClick: () => void;
}) {
  const on = state === "all";
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-md border px-2 py-0.5 text-[10px] font-medium transition ${
        on
          ? "border-primary bg-primary-light text-primary"
          : state === "some"
            ? "border-primary/50 bg-white text-primary"
            : "border-border bg-white text-muted hover:border-slate-400"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * Sets up a cross-tab plan on a wide table: a searchable list of variables,
 * grouped into questions where they share a prefix, each with two toggles
 * (compare across, measure), and a summary of the picks with the number of
 * comparisons they imply. It posts the choices as hidden form fields, so the
 * surrounding form's Save button is unchanged.
 */
export default function BannerPlanPicker({
  variables,
  groups,
  initial,
  suggested,
}: {
  variables: VariableProfile[];
  groups: VariableGroup[];
  initial: Plan;
  suggested: Plan | null;
}) {
  const [banner, setBanner] = useState<string[]>(initial.banner);
  const [stub, setStub] = useState<string[]>(initial.stub);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | VariableKind>("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [limit, setLimit] = useState(PAGE);

  const byName = useMemo(() => new Map(variables.map((v) => [v.name, v])), [variables]);
  const groupOf = useMemo(() => {
    const m = new Map<string, VariableGroup>();
    for (const g of groups) for (const name of g.members) m.set(name, g);
    return m;
  }, [groups]);

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Entry[] = [];
    const seen = new Set<string>();
    for (const v of variables) {
      const g = groupOf.get(v.name);
      if (filter === "text") {
        if (v.kind !== "text") continue;
      } else {
        if (v.kind === "text") continue;
        if (filter !== "all" && v.kind !== filter) continue;
      }
      if (g) {
        if (seen.has(g.key)) continue;
        seen.add(g.key);
        const members = g.members
          .map((n) => byName.get(n))
          .filter((m): m is VariableProfile => !!m)
          .filter((m) => filter === "all" || m.kind === filter)
          .filter((m) => q === "" || g.label.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
        if (members.length === 0) continue;
        out.push({ kind: "group", group: g, members });
      } else if (q === "" || v.name.toLowerCase().includes(q)) {
        out.push({ kind: "variable", variable: v });
      }
    }
    return out;
  }, [variables, groupOf, byName, query, filter]);

  function stateOf(names: string[], list: string[]): "all" | "some" | "none" {
    const hits = names.filter((n) => list.includes(n)).length;
    return hits === 0 ? "none" : hits === names.length ? "all" : "some";
  }

  function toggle(names: string[], role: "across" | "measure") {
    const mine = role === "across" ? banner : stub;
    const other = role === "across" ? stub : banner;
    const setMine = role === "across" ? setBanner : setStub;
    const setOther = role === "across" ? setStub : setBanner;
    const allOn = names.every((n) => mine.includes(n));
    if (allOn) setMine(mine.filter((n) => !names.includes(n)));
    else {
      setMine([...mine, ...names.filter((n) => !mine.includes(n))]);
      setOther(other.filter((n) => !names.includes(n)));
    }
  }

  const pairs = banner.length * stub.filter((s) => !banner.includes(s)).length;

  return (
    <div className="space-y-2">
      {banner.map((c) => (
        <input key={`b-${c}`} type="hidden" name="bannerColumns" value={c} />
      ))}
      {stub.map((c) => (
        <input key={`s-${c}`} type="hidden" name="stubColumns" value={c} />
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          placeholder={`Search ${variables.length.toLocaleString()} variables`}
          className="min-w-[10rem] flex-1 rounded-md border border-border px-2 py-1 text-[11px]"
        />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setFilter(f.id);
                setLimit(PAGE);
              }}
              className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${
                filter === f.id
                  ? "border-primary bg-primary-light text-primary"
                  : "border-border bg-white text-muted hover:border-slate-400"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {suggested && (
          <button
            type="button"
            onClick={() => {
              setBanner(suggested.banner);
              setStub(suggested.stub);
            }}
            className="rounded-md border border-border bg-white px-2 py-0.5 text-[10px] font-medium text-foreground hover:border-slate-400"
          >
            Use suggested plan
          </button>
        )}
      </div>

      <div className="grid gap-2 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="max-h-72 overflow-y-auto rounded-md border border-border bg-white">
          {entries.length === 0 && (
            <p className="p-3 text-[11px] text-muted">No variables match.</p>
          )}
          {entries.slice(0, limit).map((e) => {
            if (e.kind === "variable") {
              const v = e.variable;
              return (
                <div key={v.name} className="flex items-center justify-between gap-2 border-b border-border px-2 py-1 last:border-0">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] text-foreground" title={v.name}>
                      {v.name}
                    </p>
                    <p className="text-[10px] text-muted">
                      {KIND_LABEL[v.kind]}, {v.distinct} values
                      {v.missingPct > 0 ? `, ${v.missingPct}% missing` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Toggle label="Across" state={stateOf([v.name], banner)} onClick={() => toggle([v.name], "across")} />
                    <Toggle label="Measure" state={stateOf([v.name], stub)} onClick={() => toggle([v.name], "measure")} />
                  </div>
                </div>
              );
            }
            const names = e.members.map((m) => m.name);
            const isOpen = open[e.group.key] ?? false;
            return (
              <div key={e.group.key} className="border-b border-border last:border-0">
                <div className="flex items-center justify-between gap-2 bg-slate-50 px-2 py-1">
                  <button
                    type="button"
                    onClick={() => setOpen({ ...open, [e.group.key]: !isOpen })}
                    className="min-w-0 text-left"
                  >
                    <p className="truncate text-[11px] font-medium text-foreground">
                      {isOpen ? "▾" : "▸"} {e.group.label}
                    </p>
                    <p className="text-[10px] text-muted">
                      {e.group.type === "multi_response"
                        ? `Multi-response question, ${names.length} yes/no flags`
                        : `Set of ${names.length} related variables`}
                    </p>
                  </button>
                  <div className="flex shrink-0 gap-1">
                    <Toggle label="Across" state={stateOf(names, banner)} onClick={() => toggle(names, "across")} />
                    <Toggle label="Measure" state={stateOf(names, stub)} onClick={() => toggle(names, "measure")} />
                  </div>
                </div>
                {isOpen &&
                  e.members.map((v) => (
                    <div key={v.name} className="flex items-center justify-between gap-2 px-2 py-1 pl-5">
                      <p className="truncate text-[11px] text-foreground" title={v.name}>
                        {v.name}
                      </p>
                      <div className="flex shrink-0 gap-1">
                        <Toggle label="Across" state={stateOf([v.name], banner)} onClick={() => toggle([v.name], "across")} />
                        <Toggle label="Measure" state={stateOf([v.name], stub)} onClick={() => toggle([v.name], "measure")} />
                      </div>
                    </div>
                  ))}
              </div>
            );
          })}
          {entries.length > limit && (
            <button
              type="button"
              onClick={() => setLimit(limit + PAGE)}
              className="w-full p-2 text-[11px] font-medium text-primary hover:bg-slate-50"
            >
              Show more ({entries.length - limit} left)
            </button>
          )}
        </div>

        <div className="space-y-2 rounded-md border border-border bg-slate-50 p-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Compare across ({banner.length})
            </p>
            <p className="text-[10px] text-muted">The groups, as columns: age, region, segment.</p>
            <div className="mt-1 flex max-h-20 flex-wrap gap-1 overflow-y-auto">
              {banner.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setBanner(banner.filter((x) => x !== c))}
                  className="rounded-full bg-white px-2 py-0.5 text-[10px] text-foreground ring-1 ring-border hover:ring-danger"
                  title="Remove"
                >
                  {c} ×
                </button>
              ))}
              {banner.length === 0 && <span className="text-[10px] text-muted">None yet</span>}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Measure ({stub.length})</p>
            <p className="text-[10px] text-muted">What you compare, as rows: satisfaction, usage.</p>
            <div className="mt-1 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
              {stub.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setStub(stub.filter((x) => x !== c))}
                  className="rounded-full bg-white px-2 py-0.5 text-[10px] text-foreground ring-1 ring-border hover:ring-danger"
                  title="Remove"
                >
                  {c} ×
                </button>
              ))}
              {stub.length === 0 && <span className="text-[10px] text-muted">None yet</span>}
            </div>
          </div>
          <p className={`text-[11px] ${pairs > 100 ? "text-amber-700" : "text-muted"}`}>
            About {pairs.toLocaleString()} comparisons.
            {pairs > 100 &&
              " That is a lot. None is corrected for running many tests, so expect some false positives; narrow the measures if you can."}
          </p>
        </div>
      </div>
    </div>
  );
}
