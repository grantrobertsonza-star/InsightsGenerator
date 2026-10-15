"use client";

import { Fragment } from "react";
import { useState, type ReactNode } from "react";
import { Pane, ThreePane } from "./ThreePane";

export type PickerItem = {
  id: string;
  name: string;
  /** A short second line under the name, such as the date or how many tables are saved. */
  meta: string;
  /** Small badge text on the right of the row. */
  badge?: string;
  /** Extra content for the right-hand pane when this file is selected, shown above the shared notes. */
  side?: ReactNode;
  /** The full card for this file, rendered on the server. */
  node: ReactNode;
};

/**
 * Files on the left, the selected file's work in the middle, notes and counts on the right. One file is open at a
 * time, so a long list of files no longer means a long page of repeated cards.
 */
export default function DocumentPicker({
  title,
  items,
  right,
  rightTitle,
  empty,
  accents,
}: {
  title: string;
  items: PickerItem[];
  right: ReactNode;
  rightTitle: string;
  empty: string;
  /** Tailwind border colour classes per item, matching the colour bar on each card. */
  accents?: string[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null;
  return (
    <ThreePane
      left={
        <Pane
          side="left"
          title={title}
          badge={
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-muted">{items.length}</span>
          }
        >
          {items.length === 0 ? (
            <p className="text-sm text-muted">{empty}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item, i) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    aria-pressed={selected?.id === item.id}
                    className={`flex w-full flex-col gap-0.5 rounded-lg border border-l-4 bg-white px-3 py-2 text-left transition ${accents?.[i % accents.length] ?? "border-l-slate-300"} ${
                      selected?.id === item.id ? "border-y-primary/50 border-r-primary/50 ring-2 ring-primary/30" : "border-y-border border-r-border hover:border-y-slate-400 hover:border-r-slate-400"
                    }`}
                  >
                    <span className="truncate text-sm font-medium text-foreground" title={item.name}>
                      {item.name}
                    </span>
                    <span className="flex items-center justify-between gap-2 text-[11px] text-muted">
                      <span className="truncate">{item.meta}</span>
                      {item.badge && (
                        <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">{item.badge}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Pane>
      }
      middle={
        <Pane side="middle" title={selected?.name ?? title}>
          {selected ? <Fragment key={`node-${selected.id}`}>{selected.node}</Fragment> : <p className="text-sm text-muted">{empty}</p>}
        </Pane>
      }
      right={
        <Pane side="right" title={rightTitle}>
          {selected?.side ? <Fragment key={`side-${selected.id}`}>{selected.side}</Fragment> : null}
          <Fragment key="right">{right}</Fragment>
        </Pane>
      }
    />
  );
}
