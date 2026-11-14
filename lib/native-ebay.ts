"use client"

// The phone app (Capacitor, mobile/) reads eBay sold searches in its own eBay window, signed in as
// the member, the same way the Chrome extension does on desktop. The app loads profit.emoneydeals.com,
// so this code runs in the live site; it only does anything when Capacitor's InAppBrowser plugin
// (@capgo/inappbrowser) is there. Used through lib/sold-browser.ts.

import { collectSoldPage, ebaySoldUrl, type CollectedSold } from "@/lib/comps/collect-sold"

type Handle = { remove: () => Promise<void> }
type InAppBrowser = {
  openWebView(o: { url: string; hidden?: boolean; title?: string; isPresentAfterPageLoad?: boolean }): Promise<{ id: string }>
  executeScript(o: { code: string; id?: string }): Promise<void>
  show(o?: { id?: string }): Promise<void>
  close(o?: { id?: string }): Promise<void>
  addListener(event: "browserPageLoaded", fn: (e: { id?: string }) => void): Promise<Handle>
  addListener(event: "messageFromWebview", fn: (e: { id?: string; detail?: Record<string, unknown> }) => void): Promise<Handle>
  addListener(event: "closeEvent", fn: (e: { id?: string }) => void): Promise<Handle>
}

type CapacitorGlobal = { isNativePlatform?: () => boolean; Plugins?: { InAppBrowser?: InAppBrowser } }

function plugin(): InAppBrowser | null {
  if (typeof window === "undefined") return null
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor
  return cap?.isNativePlatform?.() ? (cap.Plugins?.InAppBrowser ?? null) : null
}

/** True inside the FlipLedger phone app (with the eBay window plugin). */
export const inPhoneApp = () => !!plugin()

/** Runs in eBay's page: collect the sold cards and send them back to the app. */
const PAGE_SCRIPT = `(() => {
  const collect = ${collectSoldPage.toString()};
  const send = () => {
    const r = collect(document);
    window.mobileApp && window.mobileApp.postMessage({ detail: { fl: "sold", rows: r.rows, total: r.total, challenged: r.challenged } });
  };
  setTimeout(send, 1500);
})()`

export type SoldRead = { ok: true; rows: CollectedSold[]; total: number | null } | { ok: false; error: string; signIn?: boolean }

/**
 * Reads one sold search in a hidden eBay window. If eBay wants a sign-in or a captcha, the window
 * is shown so the member can finish it; the read then runs again on the next page load.
 */
export async function readSoldInApp(phrase: string): Promise<SoldRead> {
  const iab = plugin()
  if (!iab) return { ok: false, error: "Open this in the FlipLedger app to read eBay sold prices." }
  const { id } = await iab.openWebView({ url: ebaySoldUrl(phrase), hidden: true, title: "eBay" })
  const handles: Handle[] = []
  let shown = false
  return new Promise<SoldRead>((resolve) => {
    const done = (r: SoldRead) => {
      clearTimeout(timer)
      handles.forEach((h) => void h.remove())
      void iab.close({ id }).catch(() => {})
      resolve(r)
    }
    // A shown window waits for the member; a hidden one gives up after 45 seconds.
    let timer = setTimeout(() => done({ ok: false, error: "eBay didn't load. Check your connection and try again." }), 45_000)
    void iab
      .addListener("browserPageLoaded", (e) => {
        if (e.id && e.id !== id) return
        void iab.executeScript({ id, code: PAGE_SCRIPT }).catch(() => {})
      })
      .then((h) => handles.push(h))
    void iab
      .addListener("messageFromWebview", (e) => {
        if ((e.id && e.id !== id) || e.detail?.fl !== "sold") return
        const rows = Array.isArray(e.detail.rows) ? (e.detail.rows as CollectedSold[]) : []
        if (rows.length || !e.detail.challenged) return done({ ok: true, rows, total: typeof e.detail.total === "number" ? e.detail.total : null })
        if (shown) return
        // Signed out or a captcha: let the member see eBay and finish it. eBay sends them back
        // to the search afterwards, and the next page load reads it.
        shown = true
        clearTimeout(timer)
        timer = setTimeout(() => done({ ok: false, error: "Sign in to eBay in the window that opened, then try again.", signIn: true }), 5 * 60_000)
        void iab.show({ id }).catch(() => {})
      })
      .then((h) => handles.push(h))
    void iab
      .addListener("closeEvent", (e) => {
        if (e.id && e.id !== id) return
        done({ ok: false, error: "Sign in to eBay in the window that opened, then try again.", signIn: true })
      })
      .then((h) => handles.push(h))
  })
}

/** Opens eBay's sign-in in the app's eBay window (kept between reads), for Settings. */
export async function signInToEbayInApp(): Promise<void> {
  const iab = plugin()
  if (!iab) return
  await iab.openWebView({ url: "https://signin.ebay.com/", title: "Sign in to eBay" })
}
