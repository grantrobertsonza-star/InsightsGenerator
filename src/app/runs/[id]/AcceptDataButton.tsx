"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveDataSetupAction } from "@/lib/dataSetupActions";
import type { DataSetup } from "@/lib/dataSetupShared";

/** Accepts a data file from the Cross tabs panel and opens the workspace, so nobody has to go back to Import. */
export default function AcceptDataButton({ runId, documentId, setup }: { runId: string; documentId: string; setup: DataSetup }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-danger">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const r = await saveDataSetupAction(runId, documentId, { ...setup, accepted: true });
          if (r.ok) router.refresh();
          else setError(r.error);
          setPending(false);
        }}
        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Accepting..." : "Accept and open workspace"}
      </button>
    </span>
  );
}
