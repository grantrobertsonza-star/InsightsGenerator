"use client";

import { TrashIcon } from "@/components/icons";

export default function DeleteDocumentButton() {
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (!confirm("Delete this document and any findings extracted from it? This can't be undone.")) {
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
