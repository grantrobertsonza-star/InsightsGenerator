/**
 * Shown on a kept objective or decision when a file it was drawn from has been removed to the bin
 * (claude/document-deletion-contract.md section 4). The wording stays as the researcher kept it;
 * restoring the file clears the tag.
 */
export default function SourceRemovedTag({ removedAt }: { removedAt: string | null | undefined }) {
  if (!removedAt) return null;
  return (
    <span
      className="inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
      title="A file this was drawn from has been removed from the project. It is in the bin under Import data, where it can be restored."
      data-testid="source-removed-tag"
    >
      Source document removed
    </span>
  );
}
