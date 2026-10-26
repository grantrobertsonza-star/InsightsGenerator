"use client";

import { useGoToSection } from "./RunShell";

// Opens Research quality review with this document preselected. Navigation only: it starts no
// review and makes no model call.
export const RQ_PRESELECT_EVENT = "research-quality-preselect";

export default function ReviewResearchQualityLink({ documentId }: { documentId: string }) {
  const go = useGoToSection();
  return (
    <button
      type="button"
      className="shrink-0 text-xs text-primary hover:underline"
      onClick={() => {
        try {
          window.sessionStorage.setItem(RQ_PRESELECT_EVENT, documentId);
        } catch {
          // storage blocked: the section opens without a preselection
        }
        window.dispatchEvent(new CustomEvent(RQ_PRESELECT_EVENT, { detail: documentId }));
        go("research-quality");
      }}
    >
      Review research quality
    </button>
  );
}
