"use client";

import { TrashIcon } from "@/components/icons";
import { deleteDocumentConfirmation } from "@/lib/documentDeletionMessage";

/** GT-010: `confirmMessage` names what goes with this document; without it, general wording. */
export default function DeleteDocumentButton({ confirmMessage }: { confirmMessage?: string } = {}) {
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (!confirm(confirmMessage ?? deleteDocumentConfirmation(null))) {
          e.preventDefault();
        }
      }}
      aria-label="Delete document"
      title="Delete document"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted transition hover:border-danger hover:bg-danger-light hover:text-danger"
    >
      <TrashIcon className="h-3.5 w-3.5" />
    </button>
  );
}
