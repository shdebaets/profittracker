import { describe, expect, it } from "vitest"
import { detectCarrier, filterIncoming, incomingInfo, statusWithTracking, trackingUrl, type IncomingOrder } from "./incoming"

describe("detectCarrier", () => {
  it.each([
    ["1Z999AA10123456784", "ups"],
    ["1z 999 aa1 01 2345 6784", "ups"],
    ["9400 1000 0000 0000 0000 00", "usps"],
    ["9205590164917312751089", "usps"],
    ["EA123456789US", "usps"],
    ["TBA123456789012", "amazon"],
    ["123456789012", "fedex"],
    ["9612345678901234567890", "fedex"],
    ["C12345678901234", "ontrac"],
    ["1234567890", "dhl"],
    ["hello", null],
    ["", null],
  ])("%s → %s", (n, carrier) => {
    expect(detectCarrier(n)).toBe(carrier)
  })
})

describe("trackingUrl", () => {
  it("links to the carrier's page with the cleaned-up number", () => {
    expect(trackingUrl("1z999aa1-0123456784")).toBe("https://www.ups.com/track?tracknum=1Z999AA10123456784")
    expect(trackingUrl("9400100000000000000000")).toBe("https://tools.usps.com/go/TrackConfirmAction?tLabels=9400100000000000000000")
  })
  it("uses a saved carrier over the guess, and a web search when unknown", () => {
    expect(trackingUrl("1234567890", "fedex")).toBe("https://www.fedex.com/fedextrack/?trknbr=1234567890")
    expect(trackingUrl("ABC 123")).toBe("https://www.google.com/search?q=ABC123+tracking")
  })
})

const order = (o: Partial<IncomingOrder> = {}): IncomingOrder => ({
  id: "1", retailer: "Walmart", order_number: "200-1", ordered_at: "2026-11-18T12:00:00Z", status: "ordered", total_cents: 5000,
  lines: [{ title: "Lego", quantity: 2, estValueCents: 0 }], tracking_number: null, carrier: null, returnable: false,
  return_deadline: null, note: null, received_at: null, haul_id: null, created_at: "2026-11-18T12:00:00Z", ...o,
})

describe("incomingInfo", () => {
  const now = new Date("2026-11-20T12:00:00Z")
  it("labels the status and counts units", () => {
    expect(incomingInfo(order(), now)).toMatchObject({ label: "Ordered", tone: "brand", noTracking: false, url: null, units: 2 })
    expect(incomingInfo(order({ status: "shipped", tracking_number: "1Z999AA10123456784" }), now)).toMatchObject({
      label: "Shipped", carrierName: "UPS", url: "https://www.ups.com/track?tracknum=1Z999AA10123456784",
    })
    expect(incomingInfo(order({ status: "delivered", received_at: now.toISOString() }), now)).toMatchObject({ label: "Received", tone: "profit" })
    expect(incomingInfo(order({ status: "cancelled" }), now)).toMatchObject({ label: "Cancelled", tone: "muted" })
  })
  it("flags an order with no tracking after 7 days", () => {
    expect(incomingInfo(order({ ordered_at: "2026-11-13T12:00:00Z" }), now)).toMatchObject({ noTracking: true, tone: "warn" })
    expect(incomingInfo(order({ ordered_at: "2026-11-14T12:00:00Z" }), now).noTracking).toBe(false)
    expect(incomingInfo(order({ ordered_at: "2026-11-01T12:00:00Z", status: "shipped", tracking_number: "x" }), now).noTracking).toBe(false)
  })
})

describe("filterIncoming", () => {
  const list = [
    order({ id: "new", ordered_at: "2026-11-19T00:00:00Z" }),
    order({ id: "old", ordered_at: "2026-11-10T00:00:00Z", status: "shipped" }),
    order({ id: "got", status: "delivered", received_at: "2026-11-15T00:00:00Z" }),
    order({ id: "got2", status: "delivered", received_at: "2026-11-17T00:00:00Z" }),
    order({ id: "nope", status: "cancelled" }),
  ]
  it("splits on the way (oldest first), received (newest first) and cancelled", () => {
    expect(filterIncoming(list, "on_the_way").map((o) => o.id)).toEqual(["old", "new"])
    expect(filterIncoming(list, "received").map((o) => o.id)).toEqual(["got2", "got"])
    expect(filterIncoming(list, "cancelled").map((o) => o.id)).toEqual(["nope"])
  })
})

describe("statusWithTracking", () => {
  it("marks an ordered order shipped once it has tracking, and leaves others alone", () => {
    expect(statusWithTracking("ordered", "1Z")).toBe("shipped")
    expect(statusWithTracking("ordered", null)).toBe("ordered")
    expect(statusWithTracking("delivered", "1Z")).toBe("delivered")
    expect(statusWithTracking("cancelled", "1Z")).toBe("cancelled")
  })
})
