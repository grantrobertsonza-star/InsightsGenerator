"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/**
 * Most of this app's long-running work (processing documents, extracting
 * findings, re-verifying, creating a project from an uploaded brief) is a
 * plain form action, a real round trip through one or more Claude calls
 * that can easily take ten seconds or more. A plain <button type="submit">
 * gives no feedback for that whole stretch; the page just sits there, which
 * reads as frozen rather than working. useFormStatus reports whether the
 * form this button lives in is mid-submission, so this swaps in a spinner
 * and a working label for exactly that stretch, without needing a client
 * component wrapped around the whole form.
 *
 * Must be rendered inside the <form> whose pending state it reports; that's
 * what useFormStatus reads from.
 */
export default function SubmitButton({
  children,
  pendingLabel,
  className,
  icon,
  title,
}: {
  children: ReactNode;
  pendingLabel: string;
  className: string;
  icon?: ReactNode;
  title?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      title={title}
      className={`${className} disabled:cursor-wait disabled:opacity-70`}
    >
      {pending ? (
        <>
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {pendingLabel}
        </>
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </button>
  );
}
