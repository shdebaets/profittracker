// "Add FlipLedger to your Home Screen" (tracker row 65, Paige, Nov 24 2026).
// Pure helpers so the platform rules and the dismiss timer are unit tested.

export type InstallPlatform =
  | "ios-safari" // iPhone/iPad Safari: Share → Add to Home Screen
  | "ios-other" // Chrome/Firefox/Edge on iPhone: same Share menu, button sits elsewhere
  | "android" // Android: install prompt when the browser offers one, else the menu
  | "desktop"

export function installPlatform(ua: string, maxTouchPoints = 0): InstallPlatform {
  // iPadOS 13+ says "Macintosh" but has a touch screen.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua) ? "ios-other" : "ios-safari"
  if (/Android/.test(ua)) return "android"
  return "desktop"
}

/** "Not now" on the home screen card hides it for this long. */
export const SNOOZE_DAYS = 7
export const DISMISS_KEY = "fl-install-card"

/** Stored value is "never" (Done / "I've added it") or the ms timestamp of "Not now". */
export function isDismissed(stored: string | null, now = Date.now()): boolean {
  if (!stored) return false
  if (stored === "never") return true
  const at = Number(stored)
  return Number.isFinite(at) && now - at < SNOOZE_DAYS * 86_400_000
}
