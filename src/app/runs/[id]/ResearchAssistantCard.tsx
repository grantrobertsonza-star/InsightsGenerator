"use client";

import { Pane, ThreePane } from "./ThreePane";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendAssistantMessage, uploadAssistantDocument } from "@/lib/researchAssistantActions";
import { SendIcon, UploadIcon } from "@/components/icons";
import { AssistantMessageText } from "@/components/AssistantMessageText";
import { plainConnectionError } from "@/components/connectionError";

export type AssistantChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

/**
 * The run page's "ask anything" surface: a plain chat for this project,
 * grounded in its own accepted evidence and generated report (see
 * askResearchAssistant in src/lib/researchAssistant.ts). Sits after the
 * Insights Report section, since it's meant as the place to go once a
 * report exists, questions about the data, or a request to tighten a
 * specific line of the report, rather than a replacement for the review
 * screens above it.
 *
 * Deliberately a plain client component with local message state layered
 * on top of the server-persisted history (initialMessages), rather than a
 * full chat library: messages append optimistically on send so the chat
 * feels immediate, and a failed send shows inline rather than silently
 * losing the researcher's message.
 */
export default function ResearchAssistantCard({
  runId,
  initialMessages,
  hasReport,
}: {
  runId: string;
  initialMessages: AssistantChatMessage[];
  hasReport: boolean;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [isSending, startSending] = useTransition();
  const [isUploading, startUploading] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [failedRequest, setFailedRequest] = useState<{ text: string; id: string } | null>(null);
  // The floating drawer writes to the same conversation; when the page refreshes with a newer saved
  // history, show it (unless a send of this card's is still waiting, whose optimistic message it keeps).
  const [shownInitial, setShownInitial] = useState(initialMessages);
  if (initialMessages !== shownInitial && !isSending) {
    setShownInitial(initialMessages);
    setMessages(initialMessages);
  }

  function handleSend() {
    const text = draft.trim();
    if (!text || isSending) return;

    // The failed question sent again unchanged is the same request, so an answer the server already
    // stored is returned rather than asked and stored twice (Codex B6-F02).
    const requestId = failedRequest && failedRequest.text === text ? failedRequest.id : crypto.randomUUID();
    setError(null);
    const optimisticUser: AssistantChatMessage = {
      id: `pending-${Date.now()}`,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);
    setDraft("");

    startSending(async () => {
      let lost = false;
      const result = await sendAssistantMessage(runId, text, undefined, requestId).catch((e: unknown) => {
        lost = true;
        return { ok: false as const, error: plainConnectionError(e instanceof Error ? e.message : String(e)) };
      });
      if (result.ok) {
        setFailedRequest(null);
        setMessages((prev) => [
          ...prev,
          {
            id: `reply-${Date.now()}`,
            role: "assistant",
            content: result.reply,
            created_at: new Date().toISOString(),
          },
        ]);
      } else {
        // It leaves the list and goes back in the box with its request id.
        setFailedRequest({ text, id: requestId });
        setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
        setDraft((d) => d || text);
        if (lost) {
          // A dropped connection: the server may have stored the answer, so the saved history is
          // read again (it shows above if it was); sending again does not repeat it either way.
          router.refresh();
          setError(`No answer arrived for "${text}": the connection was lost. If it was answered, the answer appears above once the page has refreshed. Sending it again asks it once; an answer already saved is shown, not repeated.`);
        } else {
          setError(`Not answered: "${text}". ${result.error} It is back in the box to send again.`);
        }
      }
    });
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setUploadNotice(null);
    const formData = new FormData();
    formData.append("file", file);

    startUploading(async () => {
      // A dropped connection: the server may have stored and processed the file before it was lost.
      const result = await uploadAssistantDocument(runId, formData).catch((e: unknown) => ({
        ok: false as const,
        error: `${plainConnectionError(e instanceof Error ? e.message : String(e))} The file may have been uploaded anyway: check Import data before uploading it again.`,
      }));
      if (result.ok) {
        setUploadNotice(`"${file.name}" uploaded and processed. Its findings are now part of this project's evidence.`);
      } else {
        setUploadError(result.error);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  return (
    <ThreePane
      left={
        <Pane side="left" title="About this assistant">
      <p className="text-xs text-muted">
        Ask about this project&apos;s evidence, its data or its generated report, ask for a specific change to the
        report (&ldquo;shorten the executive summary&rdquo;), or ask for research advice (&ldquo;what sample do I need
        for a 5% margin of error?&rdquo;). Figures about the data come from tables it builds, saved as drafts under
        Cross tabs, All tables, so you can open and check each one; sample sizes and margins of error are worked out by
        a calculator, not estimated. You can also drop in a slide
        deck or other document here, it&apos;s processed the same way as anything uploaded above and folded into this
        project&apos;s evidence.
        {!hasReport && " No Insights Report has been generated yet, so there's nothing to revise until you generate one."}
      </p>

      <div className="flex items-center gap-2">
        <label
          className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:border-slate-400 hover:bg-primary-light hover:text-primary ${
            isUploading ? "cursor-wait opacity-70" : ""
          }`}
        >
          <UploadIcon className="h-3.5 w-3.5 text-muted" />
          {isUploading ? "Uploading..." : "Upload slides or a document"}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            disabled={isUploading}
            onChange={handleFileChange}
          />
        </label>
      </div>

      {uploadNotice && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          {uploadNotice}
        </div>
      )}
      {uploadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900">{uploadError}</div>
      )}

        </Pane>
      }
      middle={
        <Pane side="middle" title="Conversation">
      <div className="min-h-64 space-y-3 overflow-y-auto rounded-lg border border-border bg-slate-50 px-4 py-3">
        {messages.length === 0 ? (
          <p className="text-sm text-muted">No messages yet. Ask something about this project to get started.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  m.role === "user" ? "bg-primary text-white" : "border border-border bg-white text-foreground"
                }`}
              >
                {m.role === "assistant" ? <AssistantMessageText text={m.content} /> : m.content}
              </div>
            </div>
          ))
        )}
        {isSending && <p className="text-xs text-muted">Thinking...</p>}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900">{error}</div>}

      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSend();
            }
          }}
          rows={2}
          placeholder="Ask a question about the data, or ask for a change to the report..."
          className="w-full resize-none rounded-lg border border-border px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={isSending || draft.trim().length === 0}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary-hover hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
        >
          <SendIcon className="h-3.5 w-3.5" />
          Send
        </button>
      </div>
        </Pane>
      }
      right={
        <Pane side="right" title="Try asking">
          <ul className="space-y-2 text-sm text-muted">
            <li>Which findings contradict the report&apos;s main claim?</li>
            <li>What is the weakest evidence behind the top insight?</li>
            <li>Is satisfaction higher in Segment 2 than Segment 1, weighted?</li>
            <li>What sample do I need for a 3% margin of error nationally?</li>
            <li>How should I word a question about income?</li>
            <li>Shorten the executive summary.</li>
            <li>Tighten pillar 2&apos;s headline.</li>
            <li>How does StarterTabs choose means for rating scales?</li>
          </ul>
          <p className="text-xs text-muted">
            {hasReport
              ? "An Insights Report exists, so you can ask for changes to it."
              : "No Insights Report yet, so there is nothing to revise until you generate one."}
          </p>
        </Pane>
      }
    />
  );
}
