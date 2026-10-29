import { describe, expect, it, vi } from "vitest"
import type { MarketplaceId } from "@/lib/marketplaces/registry"
import type { ItemStatus, Listing } from "@/lib/types"
import { applySaleChecks, type SaleCheck, type SaleCheckStore } from "./assisted-sales"

const NOW = new Date("2026-10-29T12:00:00Z")

function listing(marketplace: MarketplaceId, status: Listing["status"] = "active"): Listing {
  return {
    id: `l-${marketplace}`, user_id: "u", item_id: "item", marketplace, status,
    external_id: null, offer_id: marketplace === "ebay" ? "offer-1" : null, external_url: `https://example/${marketplace}`,
    price_cents: 4000, last_error: null, listed_at: null, delisted_at: null,
  }
}

function fakeStore(listings: Listing[], { stock = 1, itemStatus = "inventory" as ItemStatus, failSell = false } = {}) {
  const rows = new Map(listings.map((l) => [l.id, { ...l }]))
  const claimed = new Set<string>()
  const store: SaleCheckStore = {
    sell: vi.fn(async (_id: string, qty: number) => {
      if (failSell) throw new Error("db down")
      stock -= qty
      return { remaining: stock }
    }),
    listings: async () => [...rows.values()],
    updateListing: async (id, patch) => void Object.assign(rows.get(id)!, patch),
    listing: async (id) => rows.get(id) ?? null,
    itemStatus: async () => itemStatus,
    claimSale: async (l) => (claimed.has(l.id) ? false : (claimed.add(l.id), true)),
    releaseSale: async (l) => void claimed.delete(l.id),
  }
  return { store, status: (m: MarketplaceId) => rows.get(`l-${m}`)?.status, claimed }
}

const check = (m: MarketplaceId, state: SaleCheck["state"], priceCents: number | null = null): SaleCheck => ({ listingId: `l-${m}`, state, priceCents })
const ebay = () => ({ end: vi.fn(async () => {}), setQuantity: vi.fn(async () => {}) })

describe("applySaleChecks", () => {
  it("records a Poshmark sale at the page price with Poshmark's fee, and takes the item down elsewhere", async () => {
    const { store, status } = fakeStore([listing("poshmark"), listing("mercari"), listing("ebay")])
    const adapter = ebay()
    const out = await applySaleChecks(store, { ebay: adapter }, [check("poshmark", "sold", 4500)], NOW)

    expect(out).toEqual({ sales: ["poshmark"], delisted: 0 })
    expect(store.sell).toHaveBeenCalledWith("item", 1, expect.objectContaining({
      sale_price_cents: 4500, fee_pct: 0.15, platform: "poshmark_amz", sold_at: NOW.toISOString(),
    }))
    expect(status("poshmark")).toBe("sold")
    expect(status("mercari")).toBe("delist_pending")
    expect(adapter.end).toHaveBeenCalled()
    expect(status("ebay")).toBe("delisted")
  })

  it("falls back to the listing's own price", async () => {
    const { store } = fakeStore([listing("mercari")])
    await applySaleChecks(store, {}, [check("mercari", "sold")], NOW)
    expect(store.sell).toHaveBeenCalledWith("item", 1, expect.objectContaining({ sale_price_cents: 4000, fee_pct: 0.1 }))
  })

  it("never records the same sale twice", async () => {
    const { store } = fakeStore([listing("mercari")], { stock: 3 })
    await applySaleChecks(store, {}, [check("mercari", "sold")], NOW)
    const again = await applySaleChecks(store, {}, [check("mercari", "sold")], NOW)
    expect(again.sales).toEqual([])
    expect(store.sell).toHaveBeenCalledTimes(1)
  })

  it("marks the listing sold even when units remain (one unit per listing)", async () => {
    const { store, status } = fakeStore([listing("mercari"), listing("poshmark")], { stock: 2 })
    await applySaleChecks(store, {}, [check("mercari", "sold")], NOW)
    expect(status("mercari")).toBe("sold")
    expect(status("poshmark")).toBe("active")
  })

  it("leaves items the seller already marked sold alone", async () => {
    const { store } = fakeStore([listing("poshmark")], { itemStatus: "sold" })
    const out = await applySaleChecks(store, {}, [check("poshmark", "sold")], NOW)
    expect(out.sales).toEqual([])
    expect(store.sell).not.toHaveBeenCalled()
  })

  it("confirms a pending delist once the listing is gone", async () => {
    const { store, status } = fakeStore([listing("mercari", "delist_pending"), listing("poshmark", "delist_pending")])
    const out = await applySaleChecks(store, {}, [check("mercari", "unavailable"), check("poshmark", "available")], NOW)
    expect(out).toEqual({ sales: [], delisted: 1 })
    expect(status("mercari")).toBe("delisted")
    expect(status("poshmark")).toBe("delist_pending")
    expect(store.sell).not.toHaveBeenCalled()
  })

  it("ignores live, unknown and unsupported-marketplace results", async () => {
    const { store } = fakeStore([listing("poshmark"), listing("facebook"), listing("mercari")])
    const out = await applySaleChecks(store, {}, [check("poshmark", "available"), check("facebook", "sold"), check("mercari", "unknown")], NOW)
    expect(out).toEqual({ sales: [], delisted: 0 })
    expect(store.sell).not.toHaveBeenCalled()
  })

  it("releases the claim when recording fails, so the next check retries", async () => {
    const { store, status, claimed } = fakeStore([listing("poshmark")], { failSell: true })
    const out = await applySaleChecks(store, {}, [check("poshmark", "sold")], NOW)
    expect(out.sales).toEqual([])
    expect(claimed.size).toBe(0)
    expect(status("poshmark")).toBe("active")
  })
})
