import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FlipLedger — Reseller Profit Tracker",
    short_name: "FlipLedger",
    description: "Track resale revenue, profit, inventory and business expenses.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f6f3",
    theme_color: "#f7f6f3",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
