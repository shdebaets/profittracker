// Plain, inline-styled HTML emails (mail apps ignore stylesheets). Left-aligned, one button.
import { formatCents } from "@/lib/money"
import type { WeekNumbers } from "@/lib/recap"
import { TAX_DISCLAIMER } from "@/lib/tax"

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

function layout(body: string, unsubscribe: string) {
  return `<!doctype html><html><body style="margin:0;background:#f5f4f0;font-family:Inter,Arial,sans-serif;color:#1c1917">
<div style="max-width:520px;padding:24px">
<p style="font-weight:700;font-size:18px;margin:0 0 16px">Flip<span style="color:#f5982a">Ledger</span></p>
${body}
<p style="font-size:12px;color:#78716c;margin-top:32px">You get this because you use FlipLedger. <a href="${unsubscribe}" style="color:#78716c">Unsubscribe</a></p>
</div></body></html>`
}

const button = (href: string, label: string) =>
  `<p style="margin:24px 0 0"><a href="${href}" style="display:inline-block;background:#f5982a;color:#1c1917;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:12px">${label}</a></p>`

const row = (label: string, value: string) =>
  `<tr><td style="padding:6px 0;color:#57534e">${label}</td><td style="padding:6px 0;text-align:right;font-family:monospace;font-weight:700">${value}</td></tr>`

export function recapSubject(n: WeekNumbers) {
  return `This week: ${formatCents(n.profit)} profit, ${n.itemsSold} sold, ${n.miles} mi logged`
}

export function recapEmail(n: WeekNumbers, prev: WeekNumbers, url: string, unsubscribe: string) {
  const diff = n.profit - prev.profit
  const vs = diff === 0 ? "same as last week" : `${diff > 0 ? "up" : "down"} ${formatCents(Math.abs(diff))} from last week`
  return layout(
    `<p style="font-size:28px;font-weight:800;margin:0;color:${n.profit < 0 ? "#dc2626" : "#0e8f55"}">${formatCents(n.profit)}</p>
<p style="margin:4px 0 16px;color:#57534e">profit this week, ${vs}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">
${row("Items sold", String(n.itemsSold))}
${row("Revenue", formatCents(n.revenue))}
${row(`Miles logged`, `${n.miles} mi (${formatCents(n.mileageWriteOff)} write-off)`)}
${n.topItem ? row("Top item", `${esc(n.topItem.title.slice(0, 40))} · ${formatCents(n.topItem.profit)}`) : ""}
${n.bestPlatform ? row("Best platform", `${esc(n.bestPlatform.label)} · ${formatCents(n.bestPlatform.profit)}`) : ""}
</table>
${button(url, "See your week")}`,
    unsubscribe,
  )
}

export function taxReminderEmail(
  q: { n: number; due: Date },
  profit: number,
  setAside: number,
  daysLeft: number,
  url: string,
  unsubscribe: string,
) {
  const due = q.due.toLocaleDateString("en-US", { month: "long", day: "numeric" })
  return {
    subject: `Q${q.n} estimated tax is due ${due}: set aside about ${formatCents(setAside)}`,
    html: layout(
      `<p style="font-size:20px;font-weight:700;margin:0">Q${q.n} estimated tax is due ${due}${daysLeft > 0 ? ` (${daysLeft} day${daysLeft === 1 ? "" : "s"})` : ""}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:16px">
${row("Profit this quarter", formatCents(profit))}
${row("Set aside", formatCents(setAside))}
</table>
<p style="font-size:13px;color:#57534e;margin-top:12px">Income tax at your bracket plus 15.3% self-employment tax. ${TAX_DISCLAIMER}</p>
${button(url, "See your quarter")}`,
      unsubscribe,
    ),
  }
}
