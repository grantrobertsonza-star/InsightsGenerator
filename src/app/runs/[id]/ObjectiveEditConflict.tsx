"use client";

/**
 * Shown under an objective editor whose save was refused because the objective changed after the
 * editor opened (GT1000-F03). The draft stays in the editor; nothing overwrites the newer wording
 * until the researcher chooses: continue from the current wording, or replace it with theirs.
 */
export default function ObjectiveEditConflict({
  currentText,
  pending,
  onUseCurrent,
  onReplace,
  buttonClass,
}: {
  /** null when the objective was deleted: there is nothing to continue from or replace. */
  currentText: string | null;
  pending: boolean;
  onUseCurrent: () => void;
  onReplace: () => void;
  buttonClass: string;
}) {
  if (currentText === null) {
    return (
      <p className="mt-1 max-w-md rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900" data-testid="objective-edit-conflict">
        This objective has been deleted. Your wording is still in the box; copy it before you cancel if you want to add it again.
      </p>
    );
  }
  return (
    <div className="mt-1 max-w-md rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900" data-testid="objective-edit-conflict">
      <p>
        It now reads: <span className="font-medium" data-testid="objective-edit-conflict-current">{currentText}</span>
      </p>
      <div className="mt-1 flex flex-wrap gap-1">
        <button type="button" className={buttonClass} disabled={pending} onClick={onUseCurrent} data-testid="objective-edit-use-current">
          Use the current wording
        </button>
        <button type="button" className={buttonClass} disabled={pending} onClick={onReplace} data-testid="objective-edit-replace">
          Replace it with mine
        </button>
      </div>
    </div>
  );
}
