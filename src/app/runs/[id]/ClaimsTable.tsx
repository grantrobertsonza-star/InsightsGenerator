"use client";

import { useState, useTransition } from "react";
import { setClaimStatus, setClaimKind, setClaimTheme } from "@/lib/claimActions";

type Claim = {
  id: string;
  origin: "stated" | "generated";
  claim_text: string;
  claim_kind: "own_finding" | "external_citation" | "insight" | null;
  theme: string | null;
  status: "pending" | "accepted" | "rejected";
};

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

export default function ClaimsTable({ runId, claims }: { runId: string; claims: Claim[] }) {
  const [isPending, startTransition] = useTransition();
  const [extraThemes, setExtraThemes] = useState<string[]>([]);

  const themes = Array.from(
    new Set([...claims.map((c) => c.theme).filter((t): t is string => Boolean(t)), ...extraThemes])
  ).sort();

  return (
    <>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: "8px 6px", width: "40%" }}>Claim</th>
            <th style={{ padding: "8px 6px" }}>Kind</th>
            <th style={{ padding: "8px 6px" }}>Theme</th>
            <th style={{ padding: "8px 6px" }}>Review</th>
          </tr>
        </thead>
        <tbody>
          {claims.map((claim) => (
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
                  <option value="own_finding">{kindLabel.own_finding}</option>
                  <option value="external_citation">{kindLabel.external_citation}</option>
                  <option value="insight">{kindLabel.insight}</option>
                </select>
              </td>
              <td style={{ padding: "10px 6px" }}>
                <ThemeCell
                  runId={runId}
                  claim={claim}
                  themes={themes}
                  onThemeAdded={(theme) => setExtraThemes((prev) => [...prev, theme])}
                />
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
    </>
  );
}
