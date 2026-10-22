import { describe, expect, it, vi } from "vitest"
import { UserError } from "@/lib/errors"
import type { SaleColumns } from "@/lib/items/sell"
import type { MarketplaceId } from "@/lib/marketplaces/registry"
import type { Listing } from "@/lib/types"
import { recordSale, takeDown, type Adapters, type CrosslistStore } from "./engine"

const sale: SaleColumns = {
  sale_price_cents: 5000, buyer_shipping_cents: 0, label_cost_cents: 0,
  fee_pct: 0.1, fee_fixed_cents: 0, platform: "mercari_depop", sold_at: "2026-10-17T12:00:00Z",
}

function listing(marketplace: MarketplaceId, status: Listing["status"] = "active"): Listing {
  return {
    id: `l-${marketplace}`, user_id: "u", item_id: "item", marketplace, status,
    external_id: null, offer_id: marketplace === "ebay" ? "offer-1" : null, external_url: null,
    price_cents: 5000, last_error: null, listed_at: null, delisted_at: null,
  }
}

function fakeStore(listings: Listing[], stock = 1) {
  const rows = new Map(listings.map((l) => [l.id, { ...l }]))
  const store: CrosslistStore = {
    sell: vi.fn(async (_id: string, qty: number) => {
      if (qty > stock) throw new Error("Not enough stock")
      stock -= qty
      return { remaining: stock }
    }),
    listings: async () => [...rows.values()],
    updateListing: async (id, patch) => void Object.assign(rows.get(id)!, patch),
  }
  return { store, status: (m: MarketplaceId) => rows.get(`l-${m}`)?.status, rows }
}

function fakeEbay(fail = false) {
  return {
    end: vi.fn(async () => {
      if (fail) throw new UserError("eBay is down")
    }),
    setQuantity: vi.fn(async () => {}),
  }
}

describe("recordSale", () => {
  it("sold on Mercari: ends eBay via API, flags the other assisted listings", async () => {
    const { store, status } = fakeStore([listing("ebay"), listing("mercari"), listing("depop"), listing("poshmark", "delisted")])
    const ebay = fakeEbay()
    const out = await recordSale(store, { ebay } as Adapters, { itemId: "item", qty: 1, sale, soldOn: "mercari" })

    expect(ebay.end).toHaveBeenCalledOnce()
    expect(out.ended).toEqual(["ebay"])
    expect(out.needsDelist).toEqual(["depop"])
    expect(status("mercari")).toBe("sold")
    expect(status("ebay")).toBe("delisted")
    expect(status("depop")).toBe("delist_pending")
    expect(status("poshmark")).toBe("delisted") // already down, untouched
  })

  it("sold on eBay: doesn't try to end eBay, flags the rest", async () => {
    const { store, status } = fakeStore([listing("ebay"), listing("vinted")])
    const ebay = fakeEbay()
    const out = await recordSale(store, { ebay } as Adapters, { itemId: "item", qty: 1, sale, soldOn: "ebay" })
    expect(ebay.end).not.toHaveBeenCalled()
    expect(status("ebay")).toBe("sold")
    expect(out.needsDelist).toEqual(["vinted"])
  })

  it("sold somewhere untracked: everything comes down", async () => {
    const { store } = fakeStore([listing("ebay"), listing("facebook")])
    const out = await recordSale(store, { ebay: fakeEbay() } as Adapters, { itemId: "item", qty: 1, sale, soldOn: null })
    expect(out.ended).toEqual(["ebay"])
    expect(out.needsDelist).toEqual(["facebook"])
  })

  it("partial sale of a lot keeps listings up and updates the eBay quantity", async () => {
    const { store, status } = fakeStore([listing("ebay"), listing("mercari")], 3)
    const ebay = fakeEbay()
    const out = await recordSale(store, { ebay } as Adapters, { itemId: "item", qty: 1, sale, soldOn: "mercari" })
    expect(out.remaining).toBe(2)
    expect(ebay.setQuantity).toHaveBeenCalledWith(expect.objectContaining({ marketplace: "ebay" }), 2)
    expect(ebay.end).not.toHaveBeenCalled()
    expect(status("mercari")).toBe("active")
    expect(status("ebay")).toBe("active")
  })

  it("a failed eBay end is recorded as error so it can be retried", async () => {
    const { store, rows } = fakeStore([listing("ebay"), listing("depop")])
    const out = await recordSale(store, { ebay: fakeEbay(true) } as Adapters, { itemId: "item", qty: 1, sale, soldOn: "depop" })
    expect(out.failed).toEqual([{ marketplace: "ebay", error: "eBay is down" }])
    expect(rows.get("l-ebay")).toMatchObject({ status: "error", last_error: "eBay is down" })
  })

  it("stores a friendly reason, not the raw error, when an end fails", async () => {
    const { store, rows } = fakeStore([listing("ebay"), listing("depop")])
    const broken = { end: vi.fn(async () => { throw new Error("ECONNRESET socket hang up") }), setQuantity: vi.fn() }
    await recordSale(store, { ebay: broken } as Adapters, { itemId: "item", qty: 1, sale, soldOn: "depop" })
    expect(rows.get("l-ebay")?.last_error).not.toMatch(/ECONNRESET/)
    expect(rows.get("l-ebay")?.status).toBe("error")
  })

  it("doesn't touch listings when the sale itself fails", async () => {
    const { store, status } = fakeStore([listing("ebay")], 1)
    const ebay = fakeEbay()
    await expect(recordSale(store, { ebay } as Adapters, { itemId: "item", qty: 2, sale })).rejects.toThrow()
    expect(ebay.end).not.toHaveBeenCalled()
    expect(status("ebay")).toBe("active")
  })
})

describe("takeDown", () => {
  it("retries listings whose earlier end failed", async () => {
    const { store, status } = fakeStore([listing("ebay", "error")])
    const ebay = fakeEbay()
    await takeDown(store, { ebay } as Adapters, "item")
    expect(ebay.end).toHaveBeenCalledOnce()
    expect(status("ebay")).toBe("delisted")
  })

  it("without an eBay adapter, eBay becomes a manual to-do", async () => {
    const { store, status } = fakeStore([listing("ebay")])
    const out = await takeDown(store, {}, "item")
    expect(out.needsDelist).toEqual(["ebay"])
    expect(status("ebay")).toBe("delist_pending")
  })
})
