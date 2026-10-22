// Per-tab storage for a minimised entry sheet, so it survives a full reload such as the
// eBay sign-in round trip. sessionStorage keeps it to this tab and clears with it.

const PREFIX = "entry-sheet:"

export function readSheetStore<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function writeSheetStore(key: string, value: unknown) {
  try {
    if (value == null) sessionStorage.removeItem(PREFIX + key)
    else sessionStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // storage unavailable (private mode); minimising still works until a reload
  }
}

export function clearSheetStore() {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(PREFIX)) sessionStorage.removeItem(k)
  } catch {
    // nothing stored
  }
}
