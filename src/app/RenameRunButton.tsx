"use client";

import { useRef, useState, useTransition } from "react";
import { PencilIcon } from "@/components/icons";

/**
 * A project name, editable in place. Sits as a sibling of the card's Link (not inside it), so opening the
 * editor never triggers navigation. Calls the (already runId-bound) rename action directly with the typed
 * name; there's no local echo because revalidatePath refreshes the list once the rename lands.
 */
export default function RenameRunButton({
  name,
  onRename,
}: {
  name: string;
  onRename: (name: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const submittedRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Rename project"
        className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-500 transition hover:border-primary hover:bg-primary/5 hover:text-primary"
      >
        <PencilIcon className="h-3.5 w-3.5" />
        Rename
      </button>
    );
  }

  const submit = (value: string) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== name) startTransition(() => onRename(trimmed));
  };

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit(new FormData(e.currentTarget).get("name")?.toString() ?? "");
      }}
      className="flex items-center gap-1.5"
    >
      <input
        name="name"
        defaultValue={name}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            submittedRef.current = true;
            setEditing(false);
          }
        }}
        onBlur={(e) => submit(e.currentTarget.value)}
        disabled={pending}
        className="w-40 rounded-lg border border-primary/40 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </form>
  );
}
