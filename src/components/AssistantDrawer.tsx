"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ChatIcon, CrossIcon, SendIcon } from "./icons";
import { AssistantMessageText } from "./AssistantMessageText";
import { useOpenSection } from "./openSection";
import { loadAssistantMessages, sendAssistantMessage, sendGeneralAssistantMessage } from "@/lib/researchAssistantActions";

/**
 * The floating Research assistant (Grant, 2026-10-22: "a floating Research assistant on every page
 * that the user can click on and ask questions"). A button in the bottom-right corner opens a drawer
 * from the right; the page stays visible behind it.
 *
 * Inside a project it continues the project's saved conversation (the same one as the Research
 * assistant section) with all its tools, and says which section the question came from. Elsewhere
 * (dashboard, Programs, Knowledge base, Manual) it answers how-the-app and method questions; that
 * chat lasts for the browser session and is not saved.
 *
 * Request ordering: each conversation has a key (the run id, or "general"). A reply or a load that
 * returns after the researcher has moved to another project is not shown in that project's chat
 * (the project's reply is saved, so it is there when they come back); a load older than the latest
 * one is ignored. A failed load or send is shown, never an empty or silently dropped chat.
 *
 * Each conversation keeps its own draft, waiting state and failed question (Codex B5-F05): a failed
 * send is shown only in the conversation it was sent from, whenever it arrives, with the question
 * kept and offered again. This state lasts while the app is open in the tab, not across a reload.
 *
 * Inside a project every question carries a request id, kept with a failed question and sent again
 * with it (Codex B6-F02). A send can fail before the server stored anything, or after it stored the
 * answer but before the reply reached the browser; the browser cannot tell which. So after any
 * failed send the saved history is read back: when it holds the request, the question was answered
 * and the failure is cleared, the stored answer shown; when it does not, the failure stays. Send
 * again uses the same request id, and the server returns the stored answer for a request already
 * answered (researchAssistant.ts), so a retry never stores the exchange twice. Outside a project
 * nothing is stored, so a failure there is always a question not answered.
 */

type Message = { id: string; role: "user" | "assistant"; content: string; requestId?: string | null };
type Conversation = {
  status: "idle" | "loading" | "ready" | "failed";
  messages: Message[];
  /** A failed load of the saved history. */
  error: string | null;
  draft: string;
  pending: boolean;
  /** The last question whose answer did not arrive, why, and the request it was sent as. */
  failed: { question: string; error: string; requestId: string; uncertain: boolean } | null;
};
const EMPTY: Conversation = { status: "ready", messages: [], error: null, draft: "", pending: false, failed: null };

const RUN_PATH = /^\/runs\/([0-9a-f-]{36})(?:\/|$)/i;
const HIDDEN_ON = /^\/(login|no-organisation)(\/|$)/;

export default function AssistantDrawer() {
  const pathname = usePathname() ?? "/";
  const runId = RUN_PATH.exec(pathname)?.[1] ?? null;
  const openSection = useOpenSection();
  const section = openSection && openSection.runId === runId ? openSection : null;
  const key = runId ?? "general";

  const [open, setOpen] = useState(false);
  const [conversations, setConversations] = useState<Record<string, Conversation>>({});
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  }, [key]);
  const loadSeq = useRef(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const conversation: Conversation = conversations[key] ?? { ...EMPTY, status: runId ? "idle" : "ready" };
  const update = useCallback(
    (k: string, change: (c: Conversation) => Conversation) => setConversations((all) => ({ ...all, [k]: change(all[k] ?? EMPTY) })),
    [],
  );
  const draft = conversation.draft;
  const setDraft = (text: string) => update(key, (c) => ({ ...c, draft: text }));

  // A project's conversation is read each time the drawer opens on it, so a message sent from the
  // Research assistant section in the meantime is there.
  const load = useCallback(async () => {
    if (!runId) return;
    const seq = ++loadSeq.current;
    const k = runId;
    update(k, (c) => ({ ...c, status: c.messages.length ? c.status : "loading", error: null }));
    // A dropped connection rejects the action itself; that is a failed load too, not a load in progress.
    const result = await loadAssistantMessages(k).catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }));
    if (seq !== loadSeq.current || keyRef.current !== k) return;
    // The saved history replaces the shown messages; the draft and a waiting send stay. A failed
    // question whose request is in the history was answered after all: its failure is cleared.
    if (result.ok)
      update(k, (c) => {
        const answered = c.failed !== null && result.messages.some((m) => m.request_id === c.failed!.requestId && m.role === "assistant");
        return {
          ...c,
          status: "ready",
          messages: result.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, requestId: m.request_id ?? null })),
          error: null,
          failed: answered ? null : c.failed,
          draft: answered && c.draft.trim() === c.failed!.question ? "" : c.draft,
        };
      });
    else update(k, (c) => ({ ...c, status: "failed", error: result.error }));
  }, [runId, update]);

  useEffect(() => {
    // Reading from the server when the drawer opens, or when the project changes under an open
    // drawer, is the external sync an effect is for; the state set is the load's own status.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus goes back to the button when the drawer closes (the button is rendered again only then).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) buttonRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [conversation.messages.length, conversation.pending, conversation.failed, open]);

  // On the Research assistant section the same conversation is already on the page.
  const onAssistantSection = section?.id === "assistant";
  if (HIDDEN_ON.test(pathname) || onAssistantSection) return null;

  const ready = !conversation.pending && conversation.status !== "loading" && conversation.status !== "failed";
  const canSend = draft.trim() !== "" && ready;

  /** Sends `question` (the draft, or a failed question sent again) in the current conversation. */
  function send(question: string, fromDraft: boolean) {
    const text = question.trim();
    if (!text || !ready) return;
    // The failed question sent again, from its button or unchanged from the box, is the same request.
    const requestId = conversation.failed && conversation.failed.question === text ? conversation.failed.requestId : crypto.randomUUID();
    const k = key;
    const sendRunId = runId;
    const page = { path: pathname, section: section?.label ?? null };
    const history = conversation.messages.map((m) => ({ role: m.role, content: m.content }));
    const optimisticId = `pending-${Date.now()}`;
    update(k, (c) => ({
      ...c,
      draft: fromDraft || c.draft.trim() === text ? "" : c.draft,
      pending: true,
      failed: null,
      messages: [...c.messages, { id: optimisticId, role: "user", content: text }],
    }));
    const fail = (error: string, uncertain: boolean) => {
      update(k, (c) => ({
        ...c,
        pending: false,
        // It leaves the list and is kept with the error to send again; the read-back below shows it
        // as answered instead if the server did store it.
        messages: c.messages.filter((m) => m.id !== optimisticId),
        failed: { question: text, error, requestId, uncertain: uncertain && sendRunId !== null },
        draft: c.draft || text,
      }));
      // Elsewhere, the history is read when the researcher comes back to this project.
      if (sendRunId && keyRef.current === k) void load();
    };
    const request = sendRunId ? sendAssistantMessage(sendRunId, text, page, requestId) : sendGeneralAssistantMessage(text, history, page);
    request
      .then((result) => {
        if (!result.ok) return fail(result.error, false);
        update(k, (c) => ({ ...c, pending: false, messages: [...c.messages, { id: `reply-${Date.now()}`, role: "assistant", content: result.reply }] }));
        // A project's conversation is then read back, so the saved copy (not the optimistic one) shows.
        if (sendRunId && keyRef.current === k) void load();
      })
      // A dropped connection: the server may have stored the answer before it was lost.
      .catch((error: unknown) => fail(error instanceof Error ? error.message : String(error), true));
  }

  const scope = runId
    ? `This project's conversation${section ? `, asked from ${section.label}` : ""}. Saved with the project.`
    : "How the app works and research method. This chat is not saved.";

  return (
    <>
      {!open && (
        <button
          ref={buttonRef}
          type="button"
          data-testid="assistant-fab"
          aria-expanded={false}
          aria-controls="assistant-drawer"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-white shadow-lg transition hover:bg-primary-hover hover:shadow-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary print:hidden"
        >
          <ChatIcon className="h-4 w-4" />
          Ask the assistant
        </button>
      )}
      {open && (
        <aside
          id="assistant-drawer"
          role="dialog"
          aria-modal="false"
          aria-label="Research assistant"
          data-testid="assistant-drawer"
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-white shadow-2xl sm:w-[420px] print:hidden"
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-foreground">Research assistant</h2>
              <p className="text-xs text-muted" data-testid="assistant-drawer-scope">{scope}</p>
            </div>
            <button
              type="button"
              aria-label="Close the assistant"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-muted hover:bg-slate-100 hover:text-foreground"
            >
              <CrossIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-3" data-testid="assistant-drawer-messages">
            {conversation.status === "loading" && <p className="text-sm text-muted">Loading the conversation...</p>}
            {conversation.status === "failed" && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                The conversation could not be loaded: {conversation.error}{" "}
                <button type="button" className="font-medium underline" onClick={() => void load()}>
                  Try again
                </button>
              </div>
            )}
            {conversation.status !== "loading" && conversation.status !== "failed" && conversation.messages.length === 0 && (
              <div className="space-y-2 text-sm text-muted">
                <p>{runId ? "Ask about this project's data, evidence or report, how a screen works, or research method." : "Ask how a part of the app works, or a research method question."}</p>
                <ul className="list-disc space-y-1 pl-5 text-xs">
                  {runId && <li>Is satisfaction higher among women, weighted?</li>}
                  <li>What does &quot;use with caution&quot; mean?</li>
                  <li>What sample do I need for a 5% margin of error?</li>
                  <li>How are rating scales shown in StarterTabs?</li>
                </ul>
              </div>
            )}
            {conversation.messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                    m.role === "user" ? "bg-primary text-white" : "border border-border bg-white text-foreground"
                  }`}
                >
                  {m.role === "assistant" ? <AssistantMessageText text={m.content} /> : m.content}
                </div>
              </div>
            ))}
            {conversation.pending && <p className="text-xs text-muted">Thinking...</p>}
            {conversation.failed && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" data-testid="assistant-drawer-failed">
                <p>
                  {conversation.failed.uncertain ? "No answer arrived" : "Not answered"}: &ldquo;{conversation.failed.question}&rdquo;.{" "}
                  {conversation.failed.uncertain
                    ? "The connection was lost, and the history does not show it as answered. Send again asks it once; an answer already saved is shown, not repeated."
                    : conversation.failed.error}
                </p>
                <div className="mt-1.5 flex gap-3">
                  <button type="button" className="font-medium underline disabled:opacity-60" disabled={!ready} onClick={() => send(conversation.failed!.question, false)}>
                    Send again
                  </button>
                  <button type="button" className="underline" onClick={() => update(key, (c) => ({ ...c, failed: null }))}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="flex items-end gap-2 border-t border-border px-4 py-3">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft, true);
                }
              }}
              rows={2}
              aria-label="Your question"
              placeholder="Ask a question..."
              className="w-full resize-none rounded-lg border border-border px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="button"
              onClick={() => send(draft, true)}
              disabled={!canSend}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              <SendIcon className="h-3.5 w-3.5" />
              Send
            </button>
          </div>
        </aside>
      )}
    </>
  );
}
