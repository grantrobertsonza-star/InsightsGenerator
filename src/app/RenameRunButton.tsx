"use client";

import { useRef, useState, useTransition } from "react";
import { PencilIcon } from "@/components/icons";
import { actionFailureMessage } from "./runs/[id]/actionFailure";
import type { RenameResult } from "@/lib/runActions";

/**
 * A project name, editable in place. Sits as a sibling of the card's Link (not inside it), so opening the
 * editor never triggers navigation. Calls the (already runId-bound) rename action with the typed name and
 * the stored name the editor opened from (Codex DI-F06). The editor closes only when the rename is saved;
 * a refusal keeps the typed name and says why, and when another editor renamed the project first it shows
 * the stored name with "Use current name" and "Replace with mine".
 */
export default function RenameRunButton({
  name,
  storedName,
  onRename,
}: {
  /** What the card shows (the project name, or its objective when it has none). */
  name: string;
  /** The stored project name, null when there is none: the baseline the rename is checked against. */
  storedName: string | null;
  onRename: (name: string, opened: string | null) => Promise<RenameResult>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [opened, setOpened] = useState<string | null>(storedName);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const submittedRef = useRef(false);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          submittedRef.current = false;
          setValue(name);
          setOpened(storedName);
          setError(null);
          setCurrent(undefined);
          setEditing(true);
        }}
        title="Rename project"
        className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-500 transition hover:border-primary hover:bg-primary/5 hover:text-primary"
      >
        <PencilIcon className="h-3.5 w-3.5" />
        Rename
      </button>
    );
  }

  const send = (typed: string, against: string | null) => {
    const trimmed = typed.trim();
    if (!trimmed || trimmed === (against ?? "").trim()) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      try {
        const r = await onRename(trimmed, against);
        if (r.ok) {
          setEditing(false);
          return;
        }
        submittedRef.current = false;
        setError(r.error);
        setCurrent(r.conflict ? (r.current ?? null) : undefined);
      } catch (e) {
        submittedRef.current = false;
        setError(actionFailureMessage(e));
      }
    });
  };
  const submit = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    send(value, opened);
  };

  return (
    <div className="flex max-w-xs flex-col items-end gap-1">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-center gap-1.5"
      >
        <input
          name="name"
          aria-label="Project name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              submittedRef.current = true;
              setEditing(false);
            }
          }}
          onBlur={() => {
            if (error === null) submit();
          }}
          disabled={pending}
          className="w-40 rounded-lg border border-primary/40 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </form>
      {error && (
        <p role="alert" className="text-right text-xs text-danger" data-testid="rename-error">
          {error}
        </p>
      )}
      {current !== undefined && (
        <div className="flex flex-wrap justify-end gap-1.5 text-xs">
          <span className="text-muted" data-testid="rename-stored">
            Stored now: {current ?? "(no name)"}
          </span>
          <button
            type="button"
            disabled={pending}
            className="rounded-md border border-border px-2 py-0.5 font-medium hover:border-primary"
            onClick={() => {
              setValue(current ?? "");
              setOpened(current ?? null);
              setCurrent(undefined);
              setError(null);
              setEditing(false);
            }}
          >
            Use current name
          </button>
          <button
            type="button"
            disabled={pending}
            className="rounded-md border border-border px-2 py-0.5 font-medium hover:border-primary"
            onClick={() => {
              const stored = current ?? null;
              setOpened(stored);
              setCurrent(undefined);
              setError(null);
              submittedRef.current = true;
              send(value, stored);
            }}
          >
            Replace with mine
          </button>
        </div>
      )}
    </div>
  );
}
