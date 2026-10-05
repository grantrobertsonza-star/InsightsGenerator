"use client";

import { TrashIcon } from "@/components/icons";

export default function DeleteRunButton() {
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (!confirm("Delete this project and everything in it? This can't be undone.")) {
          e.preventDefault();
        }
      }}
      className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-500 transition hover:border-danger hover:bg-danger-light hover:text-danger"
    >
      <TrashIcon className="h-3.5 w-3.5" />
      Delete
    </button>
  );
}
