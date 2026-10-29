"use client";

import { useEffect, useRef, useState, useTransition, type DragEvent } from "react";
import Link from "next/link";
import { UploadIcon } from "@/components/icons";
import { uploadDocumentsAction } from "@/lib/documentUploadActions";
import { UPLOAD_PURPOSES, purposeById, purposeMismatch, suggestPurposeFor, type UploadPurposeId } from "@/lib/uploadPurposes";
import { planUploadBatches } from "@/lib/uploadBatches";
import { FILE_LIMIT_MESSAGE } from "@/lib/importLimits";

/** `suggested` is the reason while the type is the panel's own suggestion; null once the researcher chooses. */
// `outputSetId`: statistical output from a selection whose earlier request already created its output set; a retry
// adds it to that set rather than starting another (B52-F01). `selectionId`: the selection's own id, made before
// its first request and kept on its unsent output files, so a retry joins the same set even when no reply ever
// named it (batch 65). `selectionUnconfirmed`: a request of the selection got no answer.
type Picked = {
  key: number;
  file: File;
  purpose: UploadPurposeId | "";
  suggested: string | null;
  outputSetId?: string;
  selectionId?: string;
  selectionUnconfirmed?: boolean;
};

/** A random version 4 UUID; crypto.randomUUID is missing outside a secure context (a plain-http address). */
function newSelectionId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const btn = "rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-foreground hover:border-slate-400 disabled:opacity-50";
const primary = "flex w-fit items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary-hover disabled:opacity-60";
const primarySmall = "flex w-fit items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-primary-hover disabled:opacity-60";

/** Time since the upload started, as "0:42" or "12:05". */
const elapsedText = (ms: number) => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};
const sizeText = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

/**
 * The Import heading with one "Add files" button, and the dialog it opens (Grant, 2026-10-19, from
 * his two-pane mock-up; a dialog from 2026-10-20, from his Sources prototype): drop or choose files, give each its own type, then upload. One type per
 * file, not per batch, because a batch can mix a data file and a PDF. Every file arrives with a
 * suggested type (Grant, 2026-10-21; suggestPurposeFor in uploadPurposes.ts, from the file name and,
 * for a CSV, its first lines), marked "Suggested" until the researcher changes it, so Upload need
 * not wait on a choice but a guess is never silent. Upload still waits until every file has a type
 * that fits it. Each file is sent under the form field its type always used, so the server's checks
 * and limits are unchanged.
 */
// Closed until asked for, even on an empty project: as a dialog over the page it would otherwise block
// the menu (an empty project shows its own "Use Add files" note instead).
export default function AddFilesPanel({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [outputWave, setOutputWave] = useState("");
  const [dragging, setDragging] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Grant, 29 October 2026: saving a 60 MB file "seems to take quite long" with nothing to show for it. The upload
  // goes in requests (batches) a server action answers only when done, so progress is known per request: what is
  // stored, what is being sent and saved now, and how long it has taken. Never a made-up byte count.
  const [progress, setProgress] = useState<{ total: number; stored: number; current: string[]; currentBytes: number; startedAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!progress) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [progress]);
  const nextKey = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);
  // The list as it stands when an upload returns: files chosen while it ran are still in it.
  const pickedNow = useRef<Picked[]>([]);
  useEffect(() => {
    pickedNow.current = picked;
  }, [picked]);

  function addPicked(list: FileList | null) {
    if (!list) return;
    const added = Array.from(list).map((file) => {
      const s = suggestPurposeFor(file.name);
      return { key: nextKey.current++, file, purpose: s.id as UploadPurposeId | "", suggested: s.reason };
    });
    setPicked((p) => [...p, ...added]);
    sniffCsvs(added);
    setMessage(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  // A CSV's first lines can show it is aggregated tables, a CSV, TSV or .txt file's that it is published
  // indicator data, and a .txt file's that it is a delimited data table rather than a transcript; read
  // in the background, and applied only while its type is still the panel's own suggestion, so a choice
  // made meanwhile is never undone.
  function sniffCsvs(added: Picked[]) {
    for (const p of added) {
      if (!/\.(csv|tsv|txt)$/i.test(p.file.name)) continue;
      p.file
        .slice(0, 8192)
        .text()
        .then((sample) => {
          const s = suggestPurposeFor(p.file.name, sample);
          setPicked((all) => all.map((x) => (x.key === p.key && x.suggested !== null ? { ...x, purpose: s.id, suggested: s.reason } : x)));
        })
        .catch(() => {
          // Unreadable here: the name-based suggestion stands.
        });
    }
  }

  const problems = picked.map((p) => (p.purpose === "" ? "Choose what this file is." : purposeMismatch(p.file.name, p.purpose)));
  const ready = picked.length > 0 && problems.every((x) => x === null);
  const has = (id: UploadPurposeId) => picked.some((p) => p.purpose === id);

  function upload() {
    // Sent in batches that each fit through the sign-in proxy (planUploadBatches): files chosen together
    // over 100 MB used to go in one request, which the proxy cut off, and the page failed with "Unexpected
    // end of form". A file over the per-file limit is not sent; it is named and left out of the list.
    const chosen = picked.filter((p) => p.purpose !== "").map((p) => ({ ...p, size: p.file.size }));
    const { batches, tooLarge } = planUploadBatches(chosen);
    const refused = tooLarge.map((p) => `${p.file.name}: ${FILE_LIMIT_MESSAGE}`);
    const dropped = new Set(tooLarge.map((p) => p.key));
    setMessage(null);
    setError(null);
    const totalBytes = batches.flat().reduce((n, p) => n + p.size, 0);
    let storedBytes = 0;
    // The first request's files are named here, outside the transition: an update made inside `start` before its
    // first await is held back until the whole upload finishes, so naming them in the loop alone left "Sending and
    // saving" missing for the first (often the only) request. Later requests are named in the loop, after an await.
    const first = batches.find((b) => b.length > 0) ?? [];
    setProgress({
      total: totalBytes,
      stored: 0,
      current: first.map((p) => p.file.name),
      currentBytes: first.reduce((n, p) => n + p.size, 0),
      startedAt: Date.now(),
    });
    start(async () => {
      const added: string[] = [];
      const repeats: string[] = [];
      // Only files actually sent leave the list (with the too-large ones): a batch not yet sent when an
      // earlier one fails stays chosen, so retrying sends it and never re-sends what already went through.
      const sent = new Set<number>(dropped);
      // B52-F01: one selection of statistical output is one output set, however many requests it takes. The
      // first request that carries output creates the set; every later one, and a retry of files left from a
      // failed upload, names it so the server adds to it.
      let outputSetId = chosen.find((p) => p.purpose === "output" && p.outputSetId)?.outputSetId;
      // Batch 65: the selection's own id goes with every request that carries its output, so the server finds the
      // set the first request made even when that request's reply was lost (migration 0129). Without the
      // migration the server cannot, and a request of a selection that already had a lost reply says so instead
      // of quietly starting a second set (`outputSelectionUnconfirmed`).
      const outputs = chosen.filter((p) => p.purpose === "output");
      const selectionId = outputs.length > 0 ? (outputs.find((p) => p.selectionId)?.selectionId ?? newSelectionId()) : undefined;
      let selectionUnconfirmed = outputs.some((p) => p.selectionUnconfirmed);
      let failure: string | null = null;
      for (const batch of batches) {
        // B52-F02: the list as it stands now decides what is sent. A file removed while an earlier request ran
        // is not sent; a changed type is sent as its new type; a file left without a valid type stays chosen.
        const now = new Map(pickedNow.current.map((p) => [p.key, p]));
        const items = batch
          .map((p) => now.get(p.key))
          .filter((p): p is Picked => !!p && p.purpose !== "" && purposeMismatch(p.file.name, p.purpose) === null);
        if (items.length === 0) continue;
        const data = new FormData();
        for (const p of items) {
          data.append(purposeById(p.purpose as UploadPurposeId).field, p.file);
          sent.add(p.key);
        }
        data.set("outputWave", outputWave);
        const carriesOutput = items.some((p) => p.purpose === "output");
        if (outputSetId && carriesOutput) data.set("outputSetId", outputSetId);
        if (selectionId && carriesOutput) {
          data.set("outputSelectionId", selectionId);
          if (selectionUnconfirmed && !outputSetId) data.set("outputSelectionUnconfirmed", "1");
        }
        let result: Awaited<ReturnType<typeof uploadDocumentsAction>>;
        const batchBytes = items.reduce((n, p) => n + p.file.size, 0);
        setProgress((g) => g && { ...g, current: items.map((p) => p.file.name), currentBytes: batchBytes });
        try {
          result = await uploadDocumentsAction(runId, data);
          storedBytes += batchBytes;
          setProgress((g) => g && { ...g, stored: storedBytes, current: [], currentBytes: 0 });
        } catch {
          // No answer from the server: whether these files were stored is not known, so the reader is told
          // to look rather than told they failed or succeeded.
          failure = `The upload of ${items.map((p) => p.file.name).join(", ")} did not get an answer from the server. Reload the page to see whether ${items.length === 1 ? "it was" : "they were"} added before trying again.`;
          if (carriesOutput && !outputSetId) selectionUnconfirmed = true;
          break;
        }
        if (result.outputSetId) outputSetId = result.outputSetId;
        added.push(...result.added);
        // IMP-008: files already in the project are named, not silently dropped or re-added.
        if (result.alreadyPresent) repeats.push(...result.alreadyPresent);
        if (!result.ok) {
          failure = result.error;
          break;
        }
      }
      // Output files of this selection still waiting keep its set and its selection id, so a retry completes the
      // same set.
      const inSelection = new Set(chosen.map((p) => p.key));
      const rest = pickedNow.current
        .filter((p) => !sent.has(p.key))
        .map((p) => (inSelection.has(p.key) && p.purpose === "output" ? { ...p, outputSetId, selectionId, selectionUnconfirmed } : p));
      const repeatText = repeats.length > 0 ? ` ${repeats.join(" ")}` : "";
      const problems = [...(failure ? [failure] : []), ...refused];
      // Done with nothing left to send: the dialog closes so the new sources can be checked, and the
      // message shows under the heading. Files chosen while it ran, or not yet sent, keep it open.
      if (problems.length === 0 && rest.length === 0) setOpen(false);
      if (added.length > 0 || problems.length === 0) {
        setMessage(`Added ${added.length} file${added.length === 1 ? "" : "s"}${added.length ? `: ${added.join(", ")}` : ""}.${repeatText}`);
      }
      if (problems.length > 0) setError(problems.join(" ") + (added.length === 0 ? repeatText : ""));
      setPicked(rest);
      setProgress(null);
    });
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    addPicked(e.dataTransfer.files);
  }

  const notice = (
    <>
      {message && <div role="status" data-testid="add-files-message" className="rounded-lg border border-border bg-white px-3 py-2 text-xs text-foreground">{message}</div>}
      {error && <div data-testid="add-files-error" className="rounded-lg border border-danger bg-danger-light px-3 py-2 text-xs text-danger">{error}</div>}
    </>
  );

  return (
    <div className="mb-4 flex flex-col gap-2">
      {/* Grant, 2026-10-20 (his Sources prototype): the heading on the left, Add files on the right,
          opening a dialog over the page. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="mb-0.5 text-2xl font-semibold text-foreground">Sources</h2>
          <p className="max-w-3xl text-sm text-muted">Check your inputs. Keep setup, previews and corrections together.</p>
        </div>
        <button type="button" className={primary} aria-haspopup="dialog" aria-expanded={open} aria-controls="add-files-panel" onClick={() => {
            setMessage(null);
            setError(null);
            setOpen(true);
          }}>
          <UploadIcon className="h-4 w-4" />
          Add files
        </button>
      </div>
      {!open && notice}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !pending) setOpen(false);
          }}
        >
        <section
          id="add-files-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Add files"
          data-testid="add-files"
          tabIndex={-1}
          ref={(el) => el?.focus()}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !pending) setOpen(false);
          }}
          className="flex w-full max-w-3xl flex-col gap-3 rounded-2xl border border-border bg-white p-5 shadow-xl outline-none"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
            <h3 className="text-lg font-semibold text-foreground">Add files</h3>
            <button type="button" aria-label="Close Add files" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted hover:text-foreground" disabled={pending} onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center gap-2 rounded-xl border border-dashed border-primary/60 bg-primary-light/30 px-4 py-6 text-center ${dragging ? "ring-2 ring-primary" : ""}`}
          >
            <p className="text-sm font-semibold text-foreground">Drop files here</p>
            <p className="text-xs text-muted">or choose several from your device. Each gets a suggested type; change any that is wrong.</p>
            <input ref={inputRef} type="file" multiple aria-label="Choose files to add" data-testid="add-files-input" className="text-xs" onChange={(e) => addPicked(e.target.files)} />
          </div>
          {picked.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label="Files to add">
              {picked.map((p, i) => (
                <li key={p.key} data-testid="add-files-row" className="flex flex-col gap-1 rounded-lg border border-border p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 break-words font-medium text-foreground">{p.file.name}</span>
                    <span className="text-muted">{sizeText(p.file.size)}</span>
                    <select
                      aria-label={`Type of ${p.file.name}`}
                      value={p.purpose}
                      title={p.suggested ?? undefined}
                      aria-describedby={p.suggested ? `suggested-${p.key}` : undefined}
                      onChange={(e) => setPicked((all) => all.map((x) => (x.key === p.key ? { ...x, purpose: e.target.value as UploadPurposeId | "", suggested: null } : x)))}
                      className="rounded-lg border border-border bg-white px-2 py-1 text-xs text-foreground"
                    >
                      <option value="" disabled>
                        Choose type...
                      </option>
                      {UPLOAD_PURPOSES.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                    {p.suggested && (
                      <span id={`suggested-${p.key}`} title={p.suggested} data-testid="add-files-suggested" className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800">
                        Suggested
                        <span className="sr-only">{`: ${p.suggested}. Change it if this is wrong.`}</span>
                      </span>
                    )}
                    <button type="button" className="text-muted underline" onClick={() => setPicked((all) => all.filter((x) => x.key !== p.key))} aria-label={`Remove ${p.file.name}`}>
                      Remove
                    </button>
                  </div>
                  {problems[i] ? <p className="text-danger">{problems[i]}</p> : p.purpose !== "" && <p className="text-muted">{purposeById(p.purpose).hint}</p>}
                </li>
              ))}
            </ul>
          )}
          {has("output") && (
            <label className="flex flex-col gap-1 text-xs text-muted">
              Label the wave or study of the statistical output
              <input value={outputWave} onChange={(e) => setOutputWave(e.target.value)} placeholder="optional, for example Wave 1" className="w-full max-w-xs rounded-lg border border-border bg-white px-2 py-1 text-xs text-foreground" />
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={primarySmall} disabled={!ready || pending} onClick={upload}>
              <UploadIcon className="h-3.5 w-3.5" />
              {pending ? "Uploading..." : picked.length > 1 ? `Upload ${picked.length} files` : "Upload"}
            </button>
            {picked.length > 0 && (
              <button type="button" className={btn} disabled={pending} onClick={() => setPicked([])}>
                Clear
              </button>
            )}
          </div>
          {progress && (
            <div className="flex flex-col gap-1" data-testid="upload-progress">
              <div
                role="progressbar"
                aria-label="Upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress.total > 0 ? Math.round((progress.stored / progress.total) * 100) : 0}
                className="relative h-2 w-full overflow-hidden rounded-full bg-slate-100"
              >
                <div className="absolute inset-y-0 left-0 bg-primary transition-all" style={{ width: `${progress.total > 0 ? (progress.stored / progress.total) * 100 : 0}%` }} />
                {progress.currentBytes > 0 && (
                  <div
                    className="absolute inset-y-0 animate-pulse bg-primary/40"
                    style={{ left: `${(progress.stored / progress.total) * 100}%`, width: `${(progress.currentBytes / progress.total) * 100}%` }}
                  />
                )}
              </div>
              <p className="text-[11px] text-muted" aria-live="polite">
                Stored {progress.stored === 0 ? "0" : sizeText(progress.stored)} of {sizeText(progress.total)}.
                {progress.current.length > 0 &&
                  ` Sending and saving ${progress.current.join(", ")} (${sizeText(progress.currentBytes)}); a large file is stored and its variables read before it counts as stored.`}{" "}
                {elapsedText(now - progress.startedAt)}
              </p>
            </div>
          )}
          <p className="text-[10px] text-muted">
            Not sure how to lay a file out?{" "}
            <Link href="/knowledge/preparing-files" target="_blank" className="font-medium text-primary hover:underline">
              Read how to prepare your files
            </Link>
            .
          </p>
          <p className="text-[10px] leading-snug text-muted">
            Upload only files authorised for analysis, with appropriate consent and personal information removed or lawfully
            included under POPIA. You remain responsible for these checks. The app does not detect or remove personal information.
          </p>
          {notice}
          <div className="flex justify-end border-t border-border pt-3">
            <button type="button" className={btn} disabled={pending} onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </section>
        </div>
      )}
    </div>
  );
}
