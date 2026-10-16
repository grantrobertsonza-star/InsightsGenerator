"use client";

// Numerical traceability (numberTrace.ts, migration 0101): what a reader sees on an AI-written
// insight, recommendation or narrative whose figures are not all traced to the evidence it cites.
// Presentational only. Nothing is shown when every figure traced, or when no check is stored
// (legacy or researcher-written text: no claim is made either way). The page loads every stored
// check once (figureChecks.loadRunFigureChecks) and provides them here; each card asks for its own.
import { createContext, useContext, type ReactNode } from "react";
import { figureCheckNote, type FigureCheck } from "@/lib/numberTrace";
import type { RunFigureChecks } from "@/lib/figureChecks";

export function FigureCheckNotice({ check }: { check: FigureCheck | null | undefined }) {
  const note = figureCheckNote(check);
  if (!check || !note) return null;
  return (
    <p
      data-testid="figure-check"
      data-figure-status={check.status}
      className={`rounded-md px-2 py-1.5 text-xs ${check.status === "unsupported" ? "bg-rose-50 text-rose-800" : "bg-amber-50 text-amber-800"}`}
    >
      {note}
    </p>
  );
}

const FigureChecksContext = createContext<RunFigureChecks | null>(null);

export function FigureChecksProvider({ checks, children }: { checks: RunFigureChecks; children: ReactNode }) {
  return (
    <FigureChecksContext.Provider value={checks}>
      {checks.error && (
        <p data-testid="figure-check-error" className="mb-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Whether the figures in AI-written insights, recommendations and the report trace to their evidence could not be
          loaded ({checks.error}). Treat their figures as not checked until the page loads successfully.
        </p>
      )}
      {children}
    </FigureChecksContext.Provider>
  );
}

/** The stored check for one item, shown in its card. */
export function FigureCheckFor({ kind, id }: { kind: "preInsights" | "synthesizedInsights" | "recommendations"; id: string }) {
  const checks = useContext(FigureChecksContext);
  return <FigureCheckNotice check={checks?.[kind][id]} />;
}
