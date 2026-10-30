"use client";

// Choosing one question from a long variable list by typing (CB1, Grant 29 October 2026). The matching and order
// are searchVariables' (src/lib/variableSearch.ts); this only shows them. The value is the variable's name, its
// identity; the label is shown beside it.
import { useId, useMemo, useRef, useState } from "react";
import { searchVariables, type SearchableVariable } from "@/lib/variableSearch";

/** More than this many matches are not listed at once: typing narrows them. */
const SHOWN = 50;

export function variableText(v: SearchableVariable): string {
  return v.label && v.label !== v.name ? `${v.label} (${v.name})` : v.name;
}

export function QuestionPicker({
  value,
  options,
  noneLabel,
  onChange,
  ariaLabel,
}: {
  value: string | null;
  options: SearchableVariable[];
  noneLabel: string;
  onChange: (name: string | null) => void;
  ariaLabel: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => searchVariables(query, options), [query, options]);
  const shown = matches.slice(0, SHOWN);
  // Row 0 is "none"; the matches follow.
  const rows: (SearchableVariable | null)[] = [null, ...shown];
  const current = value ? options.find((o) => o.name === value) : undefined;

  const choose = (row: SearchableVariable | null) => {
    onChange(row ? row.name : null);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="relative min-w-0">
      <input
        ref={input}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        className="w-full min-w-0 rounded border border-border bg-white px-2 py-1"
        placeholder={current ? variableText(current) : value ? value : noneLabel}
        value={open ? query : current ? variableText(current) : value ?? ""}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(e.target.value.trim() ? 1 : 0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, rows.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            choose(rows[active] ?? null);
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
          }
        }}
      />
      {open && (
        <ul id={listId} role="listbox" aria-label={ariaLabel} className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded border border-border bg-white py-1 shadow-lg">
          {rows.map((row, i) => (
            <li
              key={row ? row.name : "__none"}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={row ? row.name === value : value === null}
              className={`cursor-pointer truncate px-2 py-1 ${i === active ? "bg-sky-100" : ""} ${row ? "" : "text-muted"}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(row);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {row ? variableText(row) : noneLabel}
            </li>
          ))}
          {matches.length === 0 && <li className="px-2 py-1 text-muted">No question matches &ldquo;{query}&rdquo;.</li>}
          {matches.length > SHOWN && (
            <li className="px-2 py-1 text-muted">
              Showing {SHOWN} of {matches.length}. Type more to narrow.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
