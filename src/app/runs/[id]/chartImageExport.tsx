"use client";

import { useState, type RefObject } from "react";

/**
 * Copy image and Download PNG for an inline SVG chart: the SVG is rasterised in the browser, on a white
 * background at twice its size, with no charting library and no server round trip. Shared by the bar,
 * line and histogram chart (ChartVisual) and the scatter plot (ScatterVisual), so every chart type
 * exports the same way. The chart owns the ref to its <svg>; `fallbackW`/`fallbackH` are used only when
 * the SVG has no viewBox.
 */
export function useSvgImageExport(svgRef: RefObject<SVGSVGElement | null>, filename: string, fallbackW: number, fallbackH: number) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<"copy" | "download" | null>(null);

  async function toPngBlob(scaleFactor = 2): Promise<Blob | null> {
    const svg = svgRef.current;
    if (!svg) return null;
    const xml = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error("The image could not be rendered."));
        im.src = url;
      });
      const w = svg.viewBox.baseVal.width || fallbackW;
      const h = svg.viewBox.baseVal.height || fallbackH;
      const canvas = document.createElement("canvas");
      canvas.width = w * scaleFactor;
      canvas.height = h * scaleFactor;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function download() {
    setBusy("download");
    setStatus(null);
    const blob = await toPngBlob(2);
    setBusy(null);
    if (!blob) {
      setStatus("Could not render the image.");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("Downloaded.");
  }

  async function copy() {
    setBusy("copy");
    setStatus(null);
    const blob = await toPngBlob(2);
    setBusy(null);
    if (!blob) {
      setStatus("Could not render the image.");
      return;
    }
    try {
      const Ctor = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (navigator.clipboard && "write" in navigator.clipboard && Ctor) {
        await navigator.clipboard.write([new Ctor({ "image/png": blob })]);
        setStatus("Copied. Paste it into your slide.");
      } else {
        await download();
        setStatus("This browser can't copy images, so it downloaded instead.");
      }
    } catch {
      await download();
      setStatus("Copying didn't work, so it downloaded instead.");
    }
  }

  return { status, busy, copy, download };
}

/** The Copy image and Download PNG buttons under a chart, with the last outcome beside them. */
export function ChartExportButtons({ exp }: { exp: ReturnType<typeof useSvgImageExport> }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={exp.copy}
        disabled={exp.busy !== null}
        className="rounded-lg border border-primary px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 disabled:opacity-50"
      >
        {exp.busy === "copy" ? "Copying..." : "Copy image"}
      </button>
      <button
        type="button"
        onClick={exp.download}
        disabled={exp.busy !== null}
        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-slate-50 disabled:opacity-50"
      >
        {exp.busy === "download" ? "Downloading..." : "Download PNG"}
      </button>
      {exp.status && <span className="text-[11px] text-muted">{exp.status}</span>}
    </div>
  );
}
