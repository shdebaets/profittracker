// Incoming orders (Orders → Buying): online purchases on their way to the seller. Pure: no I/O.

export type IncomingStatus = "ordered" | "shipped" | "delivered" | "cancelled"

export type IncomingLine = { title: string; quantity: number; estValueCents: number }

export type IncomingOrder = {
  id: string
  retailer: string | null
  order_number: string | null
  ordered_at: string
  status: IncomingStatus
  total_cents: number
  lines: IncomingLine[]
  tracking_number: string | null
  carrier: string | null
  returnable: boolean
  return_deadline: string | null
  note: string | null
  received_at: string | null
  haul_id: string | null
  created_at: string
}

export type Carrier = "usps" | "ups" | "fedex" | "amazon" | "dhl" | "ontrac"

export const CARRIER_NAMES: Record<Carrier, string> = {
  usps: "USPS", ups: "UPS", fedex: "FedEx", amazon: "Amazon", dhl: "DHL", ontrac: "OnTrac",
}

/** Uppercase with spaces and dashes taken out, as carriers print them in groups. */
export const normalizeTracking = (n: string) => n.replace(/[\s-]/g, "").toUpperCase()

// Checked in order: USPS's 9x numbers before FedEx's plain digit runs.
const PATTERNS: [Carrier, RegExp][] = [
  ["ups", /^1Z[0-9A-Z]{16}$/],
  ["amazon", /^TBA\d{12}$/],
  ["usps", /^(9[1-5]\d{18,20}|82\d{8}|[A-Z]{2}\d{9}US)$/],
  ["fedex", /^(\d{12}|\d{15}|96\d{20})$/],
  ["ontrac", /^[CD]\d{14}$/],
  ["dhl", /^\d{10}$/],
]

/** Which carrier a tracking number belongs to, from its format. Null when it doesn't look like any. */
export function detectCarrier(raw: string): Carrier | null {
  const n = normalizeTracking(raw)
  return PATTERNS.find(([, re]) => re.test(n))?.[0] ?? null
}

/** The carrier's own tracking page; a web search when the carrier isn't known. */
export function trackingUrl(raw: string, carrier?: string | null): string {
  const n = encodeURIComponent(normalizeTracking(raw))
  switch ((carrier as Carrier | null) ?? detectCarrier(raw)) {
    case "usps": return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`
    case "ups": return `https://www.ups.com/track?tracknum=${n}`
    case "fedex": return `https://www.fedex.com/fedextrack/?trknbr=${n}`
    case "amazon": return `https://track.amazon.com/tracking/${n}`
    case "dhl": return `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${n}`
    case "ontrac": return `https://www.ontrac.com/tracking/?number=${n}`
    default: return `https://www.google.com/search?q=${n}+tracking`
  }
}

/** Days without a tracking number before an order gets the "check it wasn't cancelled" nudge. */
export const NO_TRACKING_DAYS = 7

export type IncomingFilter = "on_the_way" | "received" | "cancelled"

export const isOnTheWay = (o: Pick<IncomingOrder, "status" | "received_at">) => o.status !== "cancelled" && !o.received_at

export type IncomingInfo = {
  label: string
  tone: "brand" | "profit" | "muted" | "warn"
  /** Ordered a while ago and still no tracking: maybe cancelled. */
  noTracking: boolean
  carrierName: string | null
  url: string | null
  units: number
}

const DAY = 86_400_000

export function incomingInfo(o: IncomingOrder, now = new Date()): IncomingInfo {
  const carrier = (o.carrier as Carrier | null) ?? (o.tracking_number ? detectCarrier(o.tracking_number) : null)
  const noTracking =
    o.status === "ordered" && !o.tracking_number && now.getTime() - new Date(o.ordered_at).getTime() >= NO_TRACKING_DAYS * DAY
  const label =
    o.status === "cancelled" ? "Cancelled"
    : o.received_at ? "Received"
    : o.status === "delivered" ? "Delivered"
    : o.status === "shipped" ? "Shipped"
    : "Ordered"
  const tone: IncomingInfo["tone"] =
    o.status === "cancelled" ? "muted" : o.received_at ? "profit" : noTracking ? "warn" : "brand"
  return {
    label,
    tone,
    noTracking,
    carrierName: carrier ? CARRIER_NAMES[carrier] ?? null : null,
    url: o.tracking_number ? trackingUrl(o.tracking_number, carrier) : null,
    units: o.lines.reduce((a, l) => a + l.quantity, 0),
  }
}

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0)

/** On the way: oldest order first (the one most likely stuck). Otherwise newest first. */
export function filterIncoming(list: IncomingOrder[], filter: IncomingFilter): IncomingOrder[] {
  if (filter === "on_the_way") return list.filter(isOnTheWay).sort((a, b) => time(a.ordered_at) - time(b.ordered_at))
  const shown = filter === "received" ? list.filter((o) => !!o.received_at) : list.filter((o) => o.status === "cancelled")
  return shown.sort((a, b) => time(b.received_at ?? b.ordered_at) - time(a.received_at ?? a.ordered_at))
}

/** Status after the seller saves a tracking number: an order that was only "ordered" has shipped. */
export function statusWithTracking(status: IncomingStatus, tracking: string | null): IncomingStatus {
  return tracking && status === "ordered" ? "shipped" : status
}
