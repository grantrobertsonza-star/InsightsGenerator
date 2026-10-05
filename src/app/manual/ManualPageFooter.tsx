import Link from "next/link";
import { manualSections, manualHref } from "./sections";

/**
 * Prev/next footer, driven off the same ordered list the sidebar uses, so
 * the two never drift out of sync with each other.
 */
export function ManualPageFooter({ currentSlug }: { currentSlug: string }) {
  const index = manualSections.findIndex((s) => s.slug === currentSlug);
  const prev = index > 0 ? manualSections[index - 1] : null;
  const next = index >= 0 && index < manualSections.length - 1 ? manualSections[index + 1] : null;

  if (!prev && !next) return null;

  return (
    <div className="mt-12 flex items-center justify-between gap-4 border-t border-border pt-6">
      {prev ? (
        <Link href={manualHref(prev.slug)} className="text-sm font-medium text-primary hover:underline">
          &larr; {prev.title}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={manualHref(next.slug)} className="text-sm font-medium text-primary hover:underline">
          {next.title} &rarr;
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}
