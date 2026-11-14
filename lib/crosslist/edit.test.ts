import type { SupabaseClient } from "@supabase/supabase-js"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Listing } from "@/lib/types"

const revise = vi.fn()
vi.mock("@/lib/marketplaces/ebay/revise", () => ({ reviseEbayListing: (...a: unknown[]) => revise(...a) }))

const { mergeChanges, propagateToListings } = await import("./edit")

const listing = (id: string, marketplace: string, extra: Partial<Listing> = {}) =>
  ({ id, item_id: "item-1", marketplace, status: "active", pending_changes: null, ...extra }) as Listing

/** Just enough of the Supabase query builder: select with eq filters, and update().eq("id"). */
function fakeSupabase(rows: Listing[]) {
  const updates: { id: string; patch: Record<string, unknown> }[] = []
  const client = {
    from() {
      return {
        select() {
          const filters: [string, unknown][] = []
          const q = {
            eq(col: string, v: unknown) {
              filters.push([col, v])
              return q
            },
            then(resolve: (r: { data: Listing[]; error: null }) => void) {
              const data = rows.filter((r) => filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v))
              resolve({ data, error: null })
            },
          }
          return q
        },
        update(patch: Record<string, unknown>) {
          return { eq: async (_c: string, id: string) => void updates.push({ id, patch }) }
        },
      }
    },
  }
  return { client: client as unknown as SupabaseClient, updates }
}

describe("propagateToListings", () => {
  beforeEach(() => revise.mockReset())

  it("updates every live listing of the item", async () => {
    const { client, updates } = fakeSupabase([listing("a", "ebay"), listing("b", "poshmark")])
    const out = await propagateToListings(client, "item-1", { priceCents: 1500 }, { canUseApi: true })
    expect(out.map((o) => [o.listingId, o.status])).toEqual([["a", "synced"], ["b", "pending"]])
    expect(updates.map((u) => u.id)).toEqual(["a", "b"])
  })

  it("with listingId (Retry) touches only that listing and reports its own result", async () => {
    revise.mockRejectedValueOnce(new Error("eBay down"))
    const { client, updates } = fakeSupabase([
      listing("a", "poshmark", { sync_status: "pending" }),
      listing("b", "ebay", { sync_status: "failed", pending_changes: { priceCents: 900 } }),
    ])
    const out = await propagateToListings(client, "item-1", { priceCents: 900 }, { canUseApi: true, listingId: "b" })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ listingId: "b", status: "failed" })
    expect(updates.map((u) => u.id)).toEqual(["b"])
    expect(revise).toHaveBeenCalledTimes(1)
  })

  it("does nothing without changes", async () => {
    const { client, updates } = fakeSupabase([listing("a", "ebay")])
    expect(await propagateToListings(client, "item-1", {}, { canUseApi: true })).toEqual([])
    expect(updates).toEqual([])
  })
})

describe("mergeChanges", () => {
  it("keeps earlier pending changes and drops undefined", () => {
    expect(mergeChanges({ title: "Old", priceCents: 100 }, { priceCents: 200, description: undefined })).toEqual({ title: "Old", priceCents: 200 })
  })
})
