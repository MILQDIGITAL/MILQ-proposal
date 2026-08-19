"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print rounded bg-[var(--milq-black)] px-4 py-2 text-sm font-medium text-[var(--milq-white)]"
    >
      Download PDF
    </button>
  );
}
