/**
 * Small, discoverable hover target for a definition that doesn't fit in a
 * label. Plain title attribute underneath, so it needs no script and works
 * everywhere; the visible "i" dot signals there's something to hover, since a
 * bare label or count gives no such hint. The same text is the accessible
 * name, so screen readers hear it too. Shared by the insight quality scores
 * and the research quality scorecard.
 */
export default function InfoDot({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      role="img"
      className="ml-1 inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full bg-slate-200 align-text-top text-[9px] font-bold leading-none text-slate-500"
    >
      i
    </span>
  );
}
