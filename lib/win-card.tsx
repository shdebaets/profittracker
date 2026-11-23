import { ImageResponse } from "next/og"
import { ICON_DATA_URI, WORDMARK_ASPECT, WORDMARK_DARK_DATA_URI } from "./brand-images"
import { formatCents } from "./money"

/** The shareable "win card" PNG: real numbers from FlipLedger. 1080×1080 for Discord and socials. */
const PLACE_COLOR = ["", "#f5c542", "#cbd5e1", "#d4915a"]

export function winCard(opts: { name: string; month: string; profit: number; itemsSold: number; miles: number; badges?: { place: number; label: string }[] }) {
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: "#141210", color: "white", padding: 80, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders plain <img> */}
          <img src={ICON_DATA_URI} width={72} height={72} alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders plain <img> */}
          <img src={WORDMARK_DARK_DATA_URI} width={Math.round(52 * WORDMARK_ASPECT)} height={52} alt="FlipLedger" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" }}>
          <div style={{ fontSize: 48, color: "#a8a29e" }}>{opts.name}</div>
          <div style={{ fontSize: 150, fontWeight: 800, color: "#22c55e", lineHeight: 1.1 }}>{formatCents(opts.profit)}</div>
          <div style={{ display: "flex", fontSize: 56, fontWeight: 700 }}>{`profit in ${opts.month}`}</div>
        </div>
        {opts.badges?.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 40 }}>
            {opts.badges.map((b) => (
              <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 12, border: `3px solid ${PLACE_COLOR[b.place]}`, borderRadius: 999, padding: "10px 26px", fontSize: 32, fontWeight: 700, color: PLACE_COLOR[b.place] }}>
                {b.label}
              </div>
            ))}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 60, fontSize: 40, color: "#d6d3d1" }}>
          <span>{`${opts.itemsSold} sold`}</span>
          <span>{`${opts.miles} mi logged`}</span>
        </div>
      </div>
    ),
    { width: 1080, height: 1080 },
  )
}
