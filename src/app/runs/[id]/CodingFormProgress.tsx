"use client";

import { useFormStatus } from "react-dom";
import CodingProgressBar from "./CodingProgressBar";

/**
 * Shows the coding stage and bar under a submit button while its form is running. Must sit inside the
 * same <form> as the button, because useFormStatus reads that form's pending state.
 */
export default function CodingFormProgress({ runId }: { runId: string }) {
  const { pending } = useFormStatus();
  return <CodingProgressBar runId={runId} active={pending} />;
}
