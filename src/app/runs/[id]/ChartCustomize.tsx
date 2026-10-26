"use client";

/**
 * Small inline controls shared by the three export-ready SVG charts (ChartVisual, NpsVisual, the driver
 * quadrant): a title to type over the computed one, a legend position toggle, and a colour swatch per
 * series/segment/slice. Each chart owns its own title/legendPos/colors state and resets it when its data
 * changes; this component is just the form.
 */
export type LegendPos = "top" | "bottom";

export function ChartCustomizePanel({
  title,
  onTitle,
  legendPos,
  onLegendPos,
  colors,
  onColor,
  onResetColors,
}: {
  title: string;
  onTitle: (v: string) => void;
  legendPos?: LegendPos;
  onLegendPos?: (v: LegendPos) => void;
  colors: { label: string; value: string }[];
  onColor: (i: number, v: string) => void;
  onResetColors: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-slate-50 px-3 py-2.5 text-xs">
      <label className="flex flex-col gap-1">
        <span className="font-medium text-muted">Title</span>
        <input
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          className="w-56 rounded border border-border px-2 py-1"
        />
      </label>
      {onLegendPos && (
        <div className="flex flex-col gap-1">
          <span className="font-medium text-muted">Legend</span>
          <div className="flex gap-1">
            {(["top", "bottom"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onLegendPos(p)}
                className={`rounded border px-2 py-1 capitalize ${
                  legendPos === p ? "border-primary bg-primary text-white" : "border-border text-muted hover:bg-white"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}
      {colors.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="font-medium text-muted">Colours</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {colors.map((c, i) => (
              <label key={`${c.label}-${i}`} className="flex items-center" title={c.label}>
                <input
                  type="color"
                  value={c.value}
                  onChange={(e) => onColor(i, e.target.value)}
                  className="h-6 w-6 cursor-pointer rounded border border-border p-0"
                  aria-label={`Colour for ${c.label}`}
                />
              </label>
            ))}
          </div>
        </div>
      )}
      <button type="button" onClick={onResetColors} className="text-muted hover:underline">
        Reset
      </button>
    </div>
  );
}
