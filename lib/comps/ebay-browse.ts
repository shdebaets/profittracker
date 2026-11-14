// Live eBay listings for a barcode or keywords through the Browse API (app token, no seller login).
// eBay's public APIs don't return sold prices; those come from comp_sales (collected by the extension).
import "server-only"
import { ebayFetch } from "@/lib/marketplaces/ebay/client"
import { getAppToken } from "@/lib/marketplaces/ebay/oauth"
import type { ActiveComp } from "./stats"

type Summary = {
  title?: string
  price?: { value?: string; currency?: string }
  shippingOptions?: { shippingCost?: { value?: string } }[]
  condition?: string
  buyingOptions?: string[]
  image?: { imageUrl?: string }
}

const cents = (v: string | undefined) => (v ? Math.round(Number(v) * 100) : NaN)

export async function searchActive(input: { gtin?: string; q?: string }): Promise<{ comps: ActiveComp[]; title: string | null; image: string | null }> {
  const token = await getAppToken()
  const params = new URLSearchParams({ limit: "50", filter: "buyingOptions:{FIXED_PRICE|AUCTION},deliveryCountry:US,priceCurrency:USD" })
  if (input.gtin) params.set("gtin", input.gtin)
  else params.set("q", (input.q ?? "").slice(0, 100))
  const res = await ebayFetch<{ itemSummaries?: Summary[] }>(token, `/buy/browse/v1/item_summary/search?${params}`)
  const items = res.itemSummaries ?? []
  const comps: ActiveComp[] = items
    .filter((i) => i.price?.currency === "USD" && Number.isFinite(cents(i.price.value)))
    .map((i) => {
      const ship = i.shippingOptions?.[0]?.shippingCost?.value
      return {
        priceCents: cents(i.price!.value),
        shippingCents: ship != null ? cents(ship) : null,
        title: i.title ?? "",
        condition: i.condition ?? null,
        buyItNow: (i.buyingOptions ?? []).includes("FIXED_PRICE"),
      }
    })
  return { comps, title: items[0]?.title ?? null, image: items[0]?.image?.imageUrl ?? null }
}
