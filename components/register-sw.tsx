"use client"

import { useEffect } from "react"
// Imported for its side effect: catches the install prompt early on every page.
import "@/lib/install-prompt"

export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {})
  }, [])
  return null
}
