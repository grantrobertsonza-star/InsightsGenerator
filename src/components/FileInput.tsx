"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";

/**
 * A styled file picker that shows the full name of every selected file
 * underneath the button, in a wrapping block this component controls. A
 * plain <input type="file"> renders its selected filename as part of the
 * browser's own native chrome, right next to the button, with no way to
 * restyle or wrap that text - in a narrow grid column it just gets cut
 * off mid-name, useless for telling two similarly-named uploads apart or
 * confirming the right file was picked at all.
 *
 * Fix: hide the native input entirely (a <label> whose htmlFor points at
 * a hidden file input opens the picker exactly the same way, a standard
 * and accessible pattern - the input stays in the tab order and answers
 * Enter/Space, just invisible) and render the chosen names ourselves from
 * onChange state, wrapping normally like any other text.
 */
export default function FileInput({
  name,
  multiple = false,
  accept,
  icon,
  label,
  caption,
}: {
  name: string;
  multiple?: boolean;
  accept?: string;
  icon: ReactNode;
  label: string;
  caption?: string;
}) {
  const id = useId();
  const [fileNames, setFileNames] = useState<string[]>([]);

  return (
    <label htmlFor={id} className="block cursor-pointer">
      <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        {icon}
        {label}
      </span>
      <input
        id={id}
        type="file"
        name={name}
        multiple={multiple}
        accept={accept}
        onChange={(event) => setFileNames(Array.from(event.target.files ?? []).map((file) => file.name))}
        className="sr-only"
      />
      <span className="mt-1 inline-block rounded-lg bg-primary-light px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-blue-100">
        Choose files
      </span>
      {caption ? <span className="mt-1 block text-[11px] text-muted">{caption}</span> : null}
      {fileNames.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {fileNames.map((fileName) => (
            <li key={fileName} className="break-all text-[11px] text-foreground">
              {fileName}
            </li>
          ))}
        </ul>
      ) : null}
    </label>
  );
}
