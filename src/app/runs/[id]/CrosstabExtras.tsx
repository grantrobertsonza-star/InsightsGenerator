"use client";

import type { CrosstabResult, CrosstabDesc } from "@/lib/parseStatsFile";

// Categorical slots 1 to 6 of the reference palette, in fixed order (adjacent pairs validated for colour vision).
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];
const MAX_SERIES = SERIES.length;

type Props = { result: CrosstabResult; hiddenCols: Set<number> };

type Question = CrosstabResult["questions"][number];

function chartable(x: Question): boolean {
  return (x.kind === "single" || x.kind === "multi") && x.rows.some((r) => !r.isBase && !r.isNet);
}

/**
 * Quick charts for every single or multiple response question in the table, in table order (batch 47:
 * a starter set holds many questions, and charting only the first left the rest without one). Questions
 * that are not single or multiple response (numbers, grids) are named rather than silently skipped.
 */
export function QuickCharts({ result, hiddenCols }: Props) {
  const charted = result.questions.filter(chartable);
  const skipped = result.questions.filter((x) => !chartable(x));
  if (charted.length === 0) return <p className="text-xs text-muted">No single or multiple response question to chart.</p>;
  return (
    <div className="space-y-3" data-testid="crosstab-quick-charts">
      {charted.map((q) => (
        <QuickChart key={q.key} q={q} result={result} hiddenCols={hiddenCols} />
      ))}
      {skipped.length > 0 && (
        <p className="text-[11px] text-muted">Not charted (not a single or multiple response question): {skipped.map((x) => x.label).join("; ")}.</p>
      )}
    </div>
  );
}

/**
 * A quick clustered bar chart of one single or multiple response question:
 * one cluster per answer, one bar per banner column (column %). Bars are thin with
 * a rounded data end; the legend names every series; hovering a bar gives its figure.
 */
function QuickChart({ q, result, hiddenCols }: Props & { q: Question }) {
  const answers = q.rows.filter((r) => !r.isBase && !r.isNet).slice(0, 10);
  const firstBlock = result.columns.findIndex((c, j) => !hiddenCols.has(j));
  const cols = result.columns
    .map((c, j) => ({ c, j }))
    .filter(({ c, j }) => !hiddenCols.has(j) && c.block === (firstBlock < 0 ? 0 : result.columns[firstBlock].block))
    .slice(0, MAX_SERIES);
  if (cols.length === 0 || answers.length === 0) return null;
  const val = (r: (typeof answers)[number], j: number): number | null => r.pct[j] ?? null;
  const max = Math.max(10, ...answers.flatMap((r) => cols.map(({ j }) => val(r, j) ?? 0)));
  const top = Math.ceil(max / 10) * 10;
  const W = 760;
  const H = 260;
  const padL = 36;
  const padB = 56;
  const padT = 10;
  const plotW = W - padL - 8;
  const plotH = H - padB - padT;
  const group = plotW / answers.length;
  const bw = Math.min(18, (group * 0.8) / cols.length - 2);
  const y = (v: number) => padT + plotH - (v / top) * plotH;
  const ticks = [0, top / 2, top];
  return (
    <figure className="rounded-lg border border-border bg-white p-3" data-question-key={q.key} aria-label={`${q.label} by ${cols[0].c.blockLabel}`}>
      <figcaption className="mb-1 text-[11px] font-semibold text-foreground">
        {q.label}: % within column{result.overall ? "" : `, by ${cols[0].c.blockLabel}`}
      </figcaption>
      <div className="mb-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        {cols.map(({ c }, i) => (
          <span key={c.name} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[i] }} />
            {c.name}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="#52514e">{t}%</text>
          </g>
        ))}
        {answers.map((r, gi) => {
          const x0 = padL + gi * group + (group - cols.length * (bw + 2)) / 2;
          return (
            <g key={r.label}>
              {cols.map(({ c, j }, si) => {
                const v = val(r, j);
                if (v === null) return null;
                const h = Math.max(0, plotH - (y(v) - padT));
                const x = x0 + si * (bw + 2);
                const rad = Math.min(4, bw / 2, h);
                return (
                  <path
                    key={j}
                    d={`M${x},${padT + plotH} V${y(v) + rad} Q${x},${y(v)} ${x + rad},${y(v)} H${x + bw - rad} Q${x + bw},${y(v)} ${x + bw},${y(v) + rad} V${padT + plotH} Z`}
                    fill={SERIES[si]}
                    opacity={h <= 0 ? 0 : 1}
                  >
                    <title>{`${r.label} | ${c.name}: ${v}% (base n=${r.base[j].n.toLocaleString()})`}</title>
                  </path>
                );
              })}
              <text x={padL + gi * group + group / 2} y={H - padB + 14} textAnchor="middle" fontSize={10} fill="#0b0b0b">
                {r.label.length > 16 ? `${r.label.slice(0, 15)}...` : r.label}
                <title>{r.label}</title>
              </text>
            </g>
          );
        })}
        <line x1={padL} x2={W - 8} y1={padT + plotH} y2={padT + plotH} stroke="#94a3b8" strokeWidth={1} />
      </svg>
      {q.rows.filter((r) => !r.isBase && !r.isNet).length > answers.length && (
        <p className="text-[11px] text-muted">Showing the first {answers.length} answers.</p>
      )}
    </figure>
  );
}

/** A small histogram of one variable's distribution, as bars with the share on each. */
export function Histogram({ d }: { d: CrosstabDesc }) {
  if (!d.hist || d.hist.length === 0) return null;
  const max = Math.max(...d.hist.map((h) => h.pct), 1);
  const single = d.hist.every((h) => h.lo === h.hi);
  return (
    <div className="mt-1 flex items-end gap-1" style={{ height: 64 }} role="img" aria-label="Histogram">
      {d.hist.map((h, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col items-center justify-end" title={`${single ? h.lo : `${h.lo} to ${h.hi}`}: ${h.pct}%`}>
          <div className="w-full rounded-t" style={{ height: `${Math.max(2, (h.pct / max) * 44)}px`, background: SERIES[0] }} />
          <span className="mt-0.5 truncate text-[9px] text-muted">{single ? h.lo : h.lo}</span>
        </div>
      ))}
    </div>
  );
}

const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** Settings plus R survey code that reproduces the table's main figures. */
export function buildRCode(result: CrosstabResult): string {
  const p = result.provenance;
  if (!p) return "# This table has no saved settings. Delete it and add it again.";
  const items = p.rowItems ?? [];
  const catVars = items.flatMap((i) => (i.kind === "grid" || i.kind === "nets" ? [] : i.vars));
  const bannerVars = p.columnVars;
  const lines: string[] = [];
  lines.push("# Insights Elevator: settings used for this table");
  lines.push(`# Source file: ${p.sourceFile} (${p.cases?.toLocaleString("en-US") ?? "?"} cases)`);
  lines.push(`# Engine: ${p.engine ?? "unknown"}, built ${p.builtAt}`);
  lines.push(`# Weight: ${p.weightVar ?? "none"}; multiple comparisons: ${p.correction}`);
  lines.push(`# Design: ${p.design ? `PSU ${p.design.psu}${p.design.strata ? `, strata ${p.design.strata}` : ""}` : "weights only"}`);
  lines.push(`# Don't know, refused and not applicable: ${p.excludeDk === false ? "kept in the bases" : "excluded from the bases"}`);
  for (const f of p.filters ?? []) lines.push(`# Filter: ${f.variable} ${f.op === "between" ? `from ${f.min ?? "-"} to ${f.max ?? "-"}` : `${f.op === "notIn" ? "not in" : "in"} ${(f.values ?? []).join(", ")}`}`);
  lines.push("");
  lines.push("library(haven); library(survey)");
  lines.push(`d <- read_sav(${q(p.sourceFile)})`);
  if (p.weightVar) lines.push(`d <- d[!is.na(d[[${q(p.weightVar)}]]) & d[[${q(p.weightVar)}]] > 0, ]`);
  const lab = (v: string) => `d[[${q(v)}]]`;
  const all = Array.from(new Set([...bannerVars, ...catVars]));
  if (all.length) {
    lines.push("# Answers as labelled factors; don't know, refused and not applicable set to missing");
    lines.push(`dk <- "^(don.?t know|do not know|dk\\\\b|refus|no response|no answer|not applicable|n/?a\\\\b|not stated|unknown|missing)"`);
    lines.push(`for (v in c(${all.map(q).join(", ")})) {`);
    lines.push("  f <- as_factor(d[[v]])");
    if (p.excludeDk !== false) lines.push("  f[grepl(dk, as.character(f), ignore.case = TRUE)] <- NA");
    lines.push("  d[[v]] <- droplevels(f)");
    lines.push("}");
  }
  const ids = p.design ? `~${p.design.psu}` : "~1";
  const strata = p.design?.strata ? `, strata = ~${p.design.strata}` : "";
  const wts = p.weightVar ? `weights = ~${p.weightVar}` : "weights = ~1";
  lines.push(`des <- svydesign(ids = ${ids}${strata}, ${wts}, data = d, nest = TRUE)`);
  if (p.filters && p.filters.length) {
    const conds = p.filters.map((f) =>
      f.op === "between"
        ? [f.min != null ? `${lab(f.variable)} >= ${f.min}` : "", f.max != null ? `${lab(f.variable)} <= ${f.max}` : ""].filter(Boolean).join(" & ")
        : `${f.op === "notIn" ? "!" : ""}(as.character(as_factor(${lab(f.variable)})) %in% c(${(f.values ?? []).map(q).join(", ")}))`,
    );
    lines.push(`des <- subset(des, ${conds.map((c) => `(${c})`).join(" & ")})  # a domain, so the design is kept`);
  }
  lines.push("");
  for (const it of items) {
    if (it.kind === "grid" || it.kind === "battery") {
      lines.push(`# ${it.label ?? it.key}: averages`);
      for (const v of it.vars) lines.push(`svymean(~${v}, des, na.rm = TRUE); svyvar(~${v}, des, na.rm = TRUE)`);
      continue;
    }
    if (it.kind === "nets" || it.vars.length > 1) {
      lines.push(`# ${it.label ?? it.key}: multiple response, % of cases per option`);
      for (const v of it.vars) lines.push(bannerVars.length ? `svyby(~I(${v} == 1), ~${bannerVars[0]}, des, svymean, na.rm = TRUE)` : `svymean(~I(${v} == 1), des, na.rm = TRUE)`);
      continue;
    }
    const v = it.vars[0];
    lines.push(`# ${it.label ?? it.key}`);
    if (bannerVars.length === 0) {
      lines.push(`svymean(~${v}, des, na.rm = TRUE)`);
    } else {
      for (const b of bannerVars) {
        lines.push(`svyby(~${v}, ~${b}, des, svymean, na.rm = TRUE)   # column % of ${b}`);
        lines.push(`svychisq(~${v} + ${b}, des)                       # Rao-Scott whole-table test`);
      }
    }
  }
  return lines.join("\n");
}
