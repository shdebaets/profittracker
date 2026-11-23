// Shared by the email senders and templates (templates stay free of server-only imports so they're testable).
export const APP_URL = `https://${process.env.CANONICAL_HOST?.trim() || "profit.emoneydeals.com"}`

/** The FlipLedger wordmark at the top of every email. The alt text keeps the name visible when images are blocked. */
export const EMAIL_WORDMARK = `<p style="margin:0 0 16px"><img src="${APP_URL}/brand/wordmark-light.png" width="155" height="30" alt="FlipLedger" style="display:block;border:0;height:30px;width:155px;font-weight:700;font-size:18px;color:#1c1917"></p>`
