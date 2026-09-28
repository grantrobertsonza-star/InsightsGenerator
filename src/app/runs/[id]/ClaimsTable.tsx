"use client";

import { useState, useTransition } from "react";
import { setClaimStatus, setClaimKind, setClaimTheme } from "@/lib/claimActions";
import { getDocumentPreviewUrl } from "@/lib/previewActions";

type Claim = {
  id: string;
  origin: "stated" | "generated";
  claim_text: string;
  claim_kind: "own_finding" | "external_citation" | "insight" | null;
  theme: string | null;
  status: "pending" | "accepted" | "rejected";
  source_filename: string | null;
  source_page: number | null;
  quote_verified: boolean | null;
  source_document_id: string | null;
};

type Viewer = { url: string; page: number | null; title: string };

function DocumentPreviewPanel({ viewer, onClose }: { viewer: Viewer; onClose: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: "45vw",
        minWidth: 360,
        height: "100vh",
        background: "white",
        borderLeft: "1px solid #ccc",
        boxShadow: "-4px 0 16px rgba(0,0,0,0.15)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 14px",
          borderBottom: "1px solid #ddd",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {viewer.title}
          {viewer.page != null && <span style={{ color: "#666", fontWeight: 400 }}> &middot; page {viewer.page}</span>}
        </div>
        <button
          onClick={onClose}
          style={{ padding: "4px 10px", border: "1px solid #ccc", borderRadius: 6, background: "white", cursor: "pointer" }}
        >
          Close
        </button>
      </div>
      <iframe
        src={viewer.page != null ? `${viewer.url}#page=${viewer.page}` : viewer.url}
        style={{ flex: 1, border: "none" }}
        title="Source document preview"
      />
    </div>
  );
}

const kindLabel: Record<string, string> = {
  own_finding: "Own finding",
  external_citation: "External citation",
  insight: "Insight",
};

const statusColor: Record<string, string> = {
  pending: "#999",
  accepted: "#1E7A34",
  rejected: "#B3261E",
};

const NEW_THEME_VALUE = "__new_theme__";

function ThemeCell({
  runId,
  claim,
  themes,
  onThemeAdded,
}: {
  runId: string;
  claim: Claim;
  themes: string[];
  onThemeAdded: (theme: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [isAdding, setIsAdding] = useState(false);
  const [newTheme, setNewTheme] = useState("");

  if (isAdding) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = newTheme.trim();
          if (!value) return;
          startTransition(() => setClaimTheme(runId, claim.id, value));
          onThemeAdded(value);
          setIsAdding(false);
          setNewTheme("");
        }}
        style={{ display: "flex", gap: 4 }}
      >
        <input
          autoFocus
          value={newTheme}
          onChange={(e) => setNewTheme(e.target.value)}
          placeholder="New theme name"
          style={{ padding: 4, flex: 1 }}
        />
        <button type="submit" style={{ padding: "4px 8px" }}>
          Save
        </button>
        <button type="button" onClick={() => setIsAdding(false)} style={{ padding: "4px 8px" }}>
          Cancel
        </button>
      </form>
    );
  }

  return (
    <select
      value={claim.theme ?? ""}
      disabled={isPending}
      onChange={(e) => {
        if (e.target.value === NEW_THEME_VALUE) {
          setIsAdding(true);
          return;
        }
        startTransition(() => setClaimTheme(runId, claim.id, e.target.value));
      }}
      style={{ padding: 4, width: "100%" }}
    >
      {!claim.theme && <option value="">No theme</option>}
      {themes.map((theme) => (
        <option key={theme} value={theme}>
          {theme}
        </option>
      ))}
      <option value={NEW_THEME_VALUE}>+ Add new theme...</option>
    </select>
  );
}

const ALL = "__all__";

export default function ClaimsTable({ runId, claims }: { runId: string; claims: Claim[] }) {
  const [isPending, startTransition] = useTransition();
  const [extraThemes, setExtraThemes] = useState<string[]>([]);

  const [sourceFilter, setSourceFilter] = useState(ALL);
  const [themeFilter, setThemeFilter] = useState(ALL);
  const [kindFilter, setKindFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);

  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [viewerLoadingId, setViewerLoadingId] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);

  async function openPreview(claim: Claim) {
    if (!claim.source_document_id) return;
    setViewerError(null);
    setViewerLoadingId(claim.id);
    const result = await getDocumentPreviewUrl(claim.source_document_id);
    setViewerLoadingId(null);
    if ("error" in result) {
      setViewerError(result.error);
      return;
    }
    setViewer({ url: result.url, page: claim.source_page, title: claim.source_filename ?? "Source document" });
  }

  const themes = Array.from(
    new Set([...claims.map((c) => c.theme).filter((t): t is string => Boolean(t)), ...extraThemes])
  ).sort();

  const sources = Array.from(
    new Set(claims.map((c) => c.source_filename).filter((s): s is string => Boolean(s)))
  ).sort();

  const filteredClaims = claims.filter((claim) => {
    if (sourceFilter !== ALL && claim.source_filename !== sourceFilter) return false;
    if (themeFilter !== ALL && claim.theme !== themeFilter) return false;
    if (kindFilter !== ALL && claim.claim_kind !== kindFilter) return false;
    if (statusFilter !== ALL && claim.status !== statusFilter) return false;
    return true;
  });

  const selectStyle = { padding: "6px 8px", fontSize: 13 };
  const filtersActive =
    sourceFilter !== ALL || themeFilter !== ALL || kindFilter !== ALL || statusFilter !== ALL;

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} style={selectStyle}>
          <option value={ALL}>All sources</option>
          {sources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
        <select value={themeFilter} onChange={(e) => setThemeFilter(e.target.value)} style={selectStyle}>
          <option value={ALL}>All themes</option>
          {themes.map((theme) => (
            <option key={theme} value={theme}>
              {theme}
            </option>
          ))}
        </select>
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} style={selectStyle}>
          <option value={ALL}>All kinds</option>
          <option value="own_finding">{kindLabel.own_finding}</option>
          <option value="external_citation">{kindLabel.external_citation}</option>
          <option value="insight">{kindLabel.insight}</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value={ALL}>All statuses</option>
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
        </select>
        {filtersActive && (
          <button
            onClick={() => {
              setSourceFilter(ALL);
              setThemeFilter(ALL);
              setKindFilter(ALL);
              setStatusFilter(ALL);
            }}
            style={{ padding: "6px 10px", fontSize: 13, border: "1px solid #ccc", borderRadius: 6, background: "white", cursor: "pointer" }}
          >
            Clear filters
          </button>
        )}
        <span style={{ fontSize: 12, color: "#888" }}>
          Showing {filteredClaims.length} of {claims.length}
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: "8px 6px", width: "40%" }}>Claim</th>
            <th style={{ padding: "8px 6px" }}>Kind</th>
            <th style={{ padding: "8px 6px" }}>Theme</th>
            <th style={{ padding: "8px 6px" }}>Source</th>
            <th style={{ padding: "8px 6px" }}>Review</th>
          </tr>
        </thead>
        <tbody>
          {filteredClaims.map((claim) => (
            <tr
              key={claim.id}
              style={{ borderBottom: "1px solid #eee", opacity: claim.status === "rejected" ? 0.5 : 1 }}
            >
              <td style={{ padding: "10px 6px" }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    color: claim.origin === "generated" ? "#2A6FDB" : "#999",
                    marginBottom: 4,
                  }}
                >
                  {claim.origin}
                </div>
                {claim.claim_text}
              </td>
              <td style={{ padding: "10px 6px" }}>
                {claim.origin === "generated" ? (
                  <span style={{ color: "#999" }}>&mdash;</span>
                ) : (
                  <select
                    value={claim.claim_kind ?? ""}
                    disabled={isPending}
                    onChange={(e) =>
                      startTransition(() => {
                        setClaimKind(runId, claim.id, e.target.value as "own_finding" | "external_citation" | "insight");
                      })
                    }
                    style={{ padding: 4 }}
                  >
                    {!claim.claim_kind && <option value="">Not set</option>}
                    <option value="own_finding">{kindLabel.own_finding}</option>
                    <option value="external_citation">{kindLabel.external_citation}</option>
                    <option value="insight">{kindLabel.insight}</option>
                  </select>
                )}
              </td>
              <td style={{ padding: "10px 6px" }}>
                <ThemeCell
                  runId={runId}
                  claim={claim}
                  themes={themes}
                  onThemeAdded={(theme) => setExtraThemes((prev) => [...prev, theme])}
                />
              </td>
              <td style={{ padding: "10px 6px", fontSize: 12, color: "#666", maxWidth: 160 }}>
                {claim.source_filename ?? "\u2014"}
                {claim.source_page != null && <span> &middot; p.{claim.source_page}</span>}
                {claim.source_document_id && (
                  <div>
                    <button
                      onClick={() => openPreview(claim)}
                      disabled={viewerLoadingId === claim.id}
                      style={{
                        marginTop: 2,
                        padding: 0,
                        border: "none",
                        background: "none",
                        color: "#2A6FDB",
                        fontSize: 11,
                        cursor: "pointer",
                        textDecoration: "underline",
                      }}
                    >
                      {viewerLoadingId === claim.id ? "Opening..." : "View source"}
                    </button>
                  </div>
                )}
                {claim.quote_verified === false && (
                  <div
                    title="The quoted sentence for this claim could not be found verbatim in the source text. Worth a manual check."
                    style={{ color: "#B3261E", fontSize: 11, marginTop: 2 }}
                  >
                    &#9888; unverified quote
                  </div>
                )}
              </td>
              <td style={{ padding: "10px 6px", whiteSpace: "nowrap" }}>
                <button
                  disabled={isPending}
                  onClick={() => startTransition(() => setClaimStatus(runId, claim.id, "accepted"))}
                  style={{
                    marginRight: 6,
                    padding: "4px 10px",
                    border: "1px solid " + (claim.status === "accepted" ? "#1E7A34" : "#ccc"),
                    background: claim.status === "accepted" ? "#E5F4E9" : "white",
                    color: statusColor.accepted,
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  Accept
                </button>
                <button
                  disabled={isPending}
                  onClick={() => startTransition(() => setClaimStatus(runId, claim.id, "rejected"))}
                  style={{
                    padding: "4px 10px",
                    border: "1px solid " + (claim.status === "rejected" ? "#B3261E" : "#ccc"),
                    background: claim.status === "rejected" ? "#FBEAE9" : "white",
                    color: statusColor.rejected,
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  Reject
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {viewerError && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            maxWidth: 320,
            background: "#FBEAE9",
            border: "1px solid #B3261E",
            color: "#B3261E",
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 13,
            zIndex: 1001,
          }}
        >
          {viewerError}
          <button
            onClick={() => setViewerError(null)}
            style={{ marginLeft: 10, border: "none", background: "none", color: "#B3261E", cursor: "pointer", textDecoration: "underline" }}
          >
            Dismiss
          </button>
        </div>
      )}
      {viewer && <DocumentPreviewPanel viewer={viewer} onClose={() => setViewer(null)} />}
    </>
  );
}
