"use client";

export default function DeleteRunButton() {
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (!confirm("Delete this run and everything in it? This can't be undone.")) {
          e.preventDefault();
        }
      }}
      style={{
        padding: "6px 12px",
        background: "white",
        color: "#B3261E",
        border: "1px solid #B3261E",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 13,
        whiteSpace: "nowrap",
      }}
    >
      Delete
    </button>
  );
}
