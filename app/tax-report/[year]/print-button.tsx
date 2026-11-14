"use client"

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="shrink-0 rounded border border-black px-3 py-1.5 font-semibold print:hidden">
      Save as PDF
    </button>
  )
}
