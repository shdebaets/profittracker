import { ImageResponse } from "next/og"
import { formatCents } from "./money"

/** The shareable "win card" PNG: real numbers from FlipLedger. 1080×1080 for Discord and socials. */
export function winCard(opts: { name: string; month: string; profit: number; itemsSold: number; miles: number }) {
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: "#141210", color: "white", padding: 80, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", fontSize: 44, fontWeight: 700 }}>
          Flip<span style={{ color: "#f5982a" }}>Ledger</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" }}>
          <div style={{ fontSize: 48, color: "#a8a29e" }}>{opts.name}</div>
          <div style={{ fontSize: 150, fontWeight: 800, color: "#22c55e", lineHeight: 1.1 }}>{formatCents(opts.profit)}</div>
          <div style={{ fontSize: 56, fontWeight: 700 }}>profit in {opts.month}</div>
        </div>
        <div style={{ display: "flex", gap: 60, fontSize: 40, color: "#d6d3d1" }}>
          <span>{opts.itemsSold} sold</span>
          <span>{opts.miles} mi logged</span>
        </div>
      </div>
    ),
    { width: 1080, height: 1080 },
  )
}
