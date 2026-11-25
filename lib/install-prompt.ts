"use client"

// Chrome/Edge/Samsung fire `beforeinstallprompt` once, often before the page's
// components mount, so it's caught here at import time (RegisterSW imports this
// on every page) and handed to whichever install card is on screen.

export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

let deferred: InstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault() // we show our own button instead of the mini-infobar
    deferred = e as InstallPromptEvent
    notify()
  })
  window.addEventListener("appinstalled", () => {
    deferred = null
    installed = true
    notify()
  })
}

export const getInstallPrompt = () => deferred
export const wasJustInstalled = () => installed

export function onInstallChange(cb: () => void) {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

/** Shows the browser's install dialog. True when the person accepted. */
export async function runInstallPrompt(): Promise<boolean> {
  const e = deferred
  if (!e) return false
  deferred = null // a prompt event can only be used once
  await e.prompt()
  const { outcome } = await e.userChoice
  notify()
  return outcome === "accepted"
}

/** Already running as the Home Screen app (Android/desktop standalone, or iOS). */
export function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}
