"use client";

import { useMemo, useState, type ComponentProps, type ReactNode } from "react";
import FindingsTable, { type FindingsFilter } from "./FindingsTable";
import { AttentionRow, StatTile, WorkspaceTabs } from "./OverviewTiles";
import {
  EVIDENCE_KIND_LABEL,
  EVIDENCE_KIND_NOTE,
  EVIDENCE_KINDS,
  REPORT_CLAIM_LABEL,
  summarizeFindings,
  type EvidenceKind,
  type ReportClaimTier,
} from "@/lib/evidenceOverview";

type Tab = "overview" | "review" | "claims";

const KIND_COLOR: Record<EvidenceKind, string> = {
  survey: "bg-blue-800",
  interviews: "bg-teal-600",
  report: "bg-slate-400",
  output: "bg-violet-700",
  modelled: "bg-amber-500",
};

/**
 * The Findings section (Grant, 2026-10-21): an overview first, then the existing review screen and
 * the report claims, as tabs. The overview counts the findings the Review tab lists (lib/
 * evidenceOverview), by where their evidence comes from, so a survey table, a coded interview, a
 * report's claim, an analyst's output and a modelled result are each counted as what they are and
 * none is read as another. Every figure opens the Review tab filtered to the findings it counts, with
 * the same rules (lib/evidenceOverview: themeKeyOf, findingNeedsAttention); the filters stay editable
 * there. A headline that sums several figures opens nothing. Report-claim verdicts are counts only:
 * the Report claims tab has no verdict filter, so they are not offered as links (Codex OV-01). The review list and the report claims stay mounted (hidden) while the
 * overview shows, so a note or wording edit left unsaved there is not lost by switching tabs.
 * Opening the section changes nothing and calls no model.
 */
export default function FindingsWorkspace({
  runId,
  findings,
  wordingEdits,
  claims,
  reviewToolbar,
  claimsContent,
}: {
  runId: string;
  findings: ComponentProps<typeof FindingsTable>["findings"];
  wordingEdits: ComponentProps<typeof FindingsTable>["wordingEdits"];
  claims: { verdict_tier: ReportClaimTier | null }[];
  /** Re-verify and the exports, rendered on the server, above the review list. */
  reviewToolbar: ReactNode;
  claimsContent: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  // Each "open" is a new filter request (FindingsTable.filterRequest); the counter makes a second
  // click on the same figure apply again after the researcher changed the filters.
  const [start, setStart] = useState<{ filter: FindingsFilter; n: number }>({ filter: {}, n: 0 });
  const overview = useMemo(() => summarizeFindings(findings, claims), [findings, claims]);
  const open = (filter: FindingsFilter) => {
    setStart((s) => ({ filter, n: s.n + 1 }));
    setTab("review");
  };
  const a = overview.attention;
  const rc = overview.reportClaims;

  return (
    <div className="flex flex-col gap-4" data-testid="findings-workspace">
      <WorkspaceTabs
        label="Findings views"
        testId="findings-tab"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "review", label: `Findings (${findings.length})` },
          { id: "claims", label: `Report claims${claims.length > 0 ? ` (${claims.length})` : ""}` },
        ]}
      />

      {tab === "overview" &&
        (findings.length === 0 && claims.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            No findings yet. They come from committed cross tabs and analyses, coded transcripts, extracted reports and statistical output.
          </p>
        ) : (
          // OV-04: everything shrinks to the workspace, which the sidebar can leave very narrow; long
          // words break rather than push the page sideways (the themes table scrolls inside itself).
          <div className="flex min-w-0 flex-col gap-4 rounded-2xl bg-slate-100 p-3 [overflow-wrap:anywhere] sm:p-5" data-testid="findings-overview">
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr))]">
              <StatTile
                title="Findings reviewed"
                total={`${overview.status.total} findings`}
                headline={overview.status.accepted + overview.status.rejected}
                headlineLabel={`decided, ${overview.status.pending} waiting`}
                testId="fo-status"
                segments={[
                  { key: "accepted", label: "Accepted", count: overview.status.accepted, color: "bg-blue-800", onOpen: () => open({ status: "accepted" }) },
                  { key: "rejected", label: "Rejected", count: overview.status.rejected, color: "bg-slate-500", onOpen: () => open({ status: "rejected" }) },
                  { key: "pending", label: "Pending", count: overview.status.pending, color: "bg-slate-200", onOpen: () => open({ status: "pending" }) },
                ]}
              />
              <StatTile
                title="Evidence sources"
                total={`${overview.byKind.length} ${overview.byKind.length === 1 ? "kind" : "kinds"}`}
                headline={overview.byKind.length}
                headlineLabel={overview.byKind.length === 1 ? "kind of evidence" : "kinds of evidence"}
                testId="fo-kinds"
                segments={overview.byKind.map((k) => ({
                  key: k.kind,
                  label: EVIDENCE_KIND_LABEL[k.kind],
                  count: k.status.total,
                  color: KIND_COLOR[k.kind],
                  onOpen: () => open({ evidence: k.kind }),
                }))}
              />
              <StatTile
                title="Report claims checked"
                total={`${rc.total} claims`}
                headline={rc.robust}
                headlineLabel="supported by the evidence"
                testId="fo-claims"
                action={rc.total > 0 ? { label: `Open all ${rc.total} report claims`, onOpen: () => setTab("claims") } : undefined}
                segments={(["robust", "use_with_caution", "not_supported", "insufficient_information", "unchecked"] as const).map((t) => ({
                  key: t,
                  label: REPORT_CLAIM_LABEL[t],
                  count: rc[t],
                  color: { robust: "bg-blue-800", use_with_caution: "bg-orange-400", not_supported: "bg-orange-700", insufficient_information: "bg-slate-400", unchecked: "bg-slate-200" }[t],
                }))}
              />
            </div>

            <div className="flex flex-wrap gap-4">
              <section className="flex min-w-0 flex-[999_1_min(100%,35rem)] flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4" aria-labelledby="fo-sources-h">
                <h3 id="fo-sources-h" className="text-base font-semibold text-foreground">By evidence source</h3>
                <ul className="flex flex-col divide-y divide-slate-100" data-testid="fo-sources">
                  {EVIDENCE_KINDS.map((kind) => {
                    const k = overview.byKind.find((x) => x.kind === kind);
                    if (!k) return null;
                    return (
                      <li key={kind} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5" data-evidence-kind={kind}>
                        <span className="flex min-w-0 flex-[1_1_min(100%,16rem)] flex-col">
                          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                            <span className={`h-2.5 w-2.5 rounded-sm ${KIND_COLOR[kind]}`} aria-hidden="true" />
                            {EVIDENCE_KIND_LABEL[kind]}
                          </span>
                          <span className="text-xs text-slate-600">{EVIDENCE_KIND_NOTE[kind]}</span>
                        </span>
                        <span className="text-xs text-slate-700">{`${k.status.accepted} accepted · ${k.status.pending} pending · ${k.status.rejected} rejected`}</span>
                        <button type="button" onClick={() => open({ evidence: kind })} className="ml-auto rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-foreground hover:border-slate-400">
                          {`Review ${k.status.total}`}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="flex min-w-0 flex-[1_1_min(100%,20rem)] flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4" aria-labelledby="fo-attention-h">
                <h3 id="fo-attention-h" className="text-base font-semibold text-foreground">Needs a decision</h3>
                {a.pending + a.contradictions + a.designChanged + a.designUnknown + a.quoteNotFound + a.claimsNotSupported === 0 ? (
                  <p className="text-sm text-slate-600">Nothing waiting: every finding in use is decided and no check has raised a problem.</p>
                ) : (
                  <div className="flex flex-col gap-2" data-testid="fo-attention">
                    {a.claimsNotSupported > 0 && <AttentionRow testId="fo-attention-claims" tone="orange" count={a.claimsNotSupported} title="Report claims not supported by the evidence" detail="Listed with every other claim under the Report claims tab." />}
                    {a.contradictions > 0 && <AttentionRow testId="fo-attention-contradictions" tone="rose" count={a.contradictions} title="Findings in conflict with a report" detail="A finding contradicts a report's claim, or a report contradicts it." onOpen={() => open({ attention: "contradictions" })} />}
                    {a.designChanged > 0 && <AttentionRow testId="fo-attention-design" tone="amber" count={a.designChanged} title="Survey design changed since the table was built" detail="Standard errors and intervals may no longer match. Rebuild the table to update." onOpen={() => open({ attention: "designChanged" })} />}
                    {a.designUnknown > 0 && <AttentionRow testId="fo-attention-design-unknown" tone="slate" count={a.designUnknown} title="Survey design could not be checked" onOpen={() => open({ attention: "designUnknown" })} />}
                    {a.quoteNotFound > 0 && <AttentionRow testId="fo-attention-quote" tone="amber" count={a.quoteNotFound} title="Report quotes not found in the source" onOpen={() => open({ attention: "quoteNotFound" })} />}
                    {a.pending > 0 && <AttentionRow testId="fo-attention-pending" tone="slate" count={a.pending} title="Findings waiting for review" onOpen={() => open({ status: "pending" })} />}
                  </div>
                )}
              </section>
            </div>

            {overview.themes.length > 0 && (
              <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4" aria-labelledby="fo-themes-h">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 id="fo-themes-h" className="text-base font-semibold text-foreground">Themes at a glance</h3>
                  <span className="text-xs text-slate-600">Where each theme&apos;s evidence comes from, and what is open</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-sm" data-testid="fo-themes">
                    <thead>
                      <tr className="text-left text-xs text-slate-600">
                        <th scope="col" className="border-b border-slate-200 px-2 py-2 font-semibold">Theme</th>
                        <th scope="col" className="w-56 border-b border-slate-200 px-2 py-2 font-semibold">Findings by source</th>
                        <th scope="col" className="border-b border-slate-200 px-2 py-2 font-semibold">Reviewed</th>
                        <th scope="col" className="border-b border-slate-200 px-2 py-2 font-semibold">Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.themes.map((t) => {
                        const open_ = [
                          t.contradictions > 0 ? `${t.contradictions} in conflict` : null,
                          t.designChanged > 0 ? `${t.designChanged} design changed` : null,
                          t.designUnknown > 0 ? `${t.designUnknown} design unchecked` : null,
                          t.status.pending > 0 ? `${t.status.pending} pending` : null,
                        ].filter(Boolean);
                        return (
                          <tr key={t.key} data-theme={t.theme}>
                            <td className="border-b border-slate-100 px-2 py-2">
                              <button type="button" onClick={() => open({ theme: t.key })} className="text-left font-semibold text-foreground hover:underline">
                                {t.theme}
                              </button>
                            </td>
                            <td className="border-b border-slate-100 px-2 py-2">
                              <span className="flex items-center gap-2">
                                <span
                                  className="flex h-2 w-36 gap-0.5"
                                  role="img"
                                  aria-label={EVIDENCE_KINDS.filter((k) => t.byKind[k] > 0).map((k) => `${EVIDENCE_KIND_LABEL[k]} ${t.byKind[k]}`).join(", ")}
                                >
                                  {EVIDENCE_KINDS.filter((k) => t.byKind[k] > 0).map((k) => (
                                    <span key={k} className={`rounded-sm ${KIND_COLOR[k]}`} style={{ flex: t.byKind[k] }} />
                                  ))}
                                </span>
                                <span className="text-xs text-slate-700">{t.status.total}</span>
                              </span>
                            </td>
                            <td className="border-b border-slate-100 px-2 py-2 text-xs text-slate-700">{`${t.status.accepted} accepted, ${t.status.rejected} rejected`}</td>
                            <td className="border-b border-slate-100 px-2 py-2 text-xs text-slate-700">{open_.length > 0 ? open_.join(" · ") : "Nothing open"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
                  {overview.byKind.map((k) => (
                    <li key={k.kind} className="flex items-center gap-1.5">
                      <span className={`h-2 w-2.5 rounded-sm ${KIND_COLOR[k.kind]}`} aria-hidden="true" />
                      {EVIDENCE_KIND_LABEL[k.kind]}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className="text-xs text-slate-600">
              Each linked figure opens the findings it counts. Review status, the evidence&apos;s own checks and report verdicts are kept apart; nothing here is scored or combined.
            </p>
          </div>
        ))}

      <div className={tab === "review" ? "flex flex-col gap-3" : "hidden"} role="tabpanel" aria-label="Findings">
        {reviewToolbar}
        {findings.length === 0 ? (
          <p className="text-sm text-muted">None extracted yet.</p>
        ) : (
          <FindingsTable runId={runId} findings={findings} wordingEdits={wordingEdits} filterRequest={start} />
        )}
      </div>

      <div className={tab === "claims" ? "flex flex-col gap-3" : "hidden"} role="tabpanel" aria-label="Report claims">
        {claimsContent}
      </div>
    </div>
  );
}
