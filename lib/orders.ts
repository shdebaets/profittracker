// Orders: sold items plus what each marketplace told us about the sale. Pure: no I/O.
import { ebayOrderUrl } from "@/lib/marketplaces/ebay/mapping"
import type { MarketplaceId } from "@/lib/marketplaces/registry"
import type { Item } from "@/lib/types"

/** A marketplace_sales row as read for Orders. */
export type OrderSale = {
  marketplace: MarketplaceId
  external_order_id: string | null
  buyer: string | null
  ship_by: string | null
  order_status: string | null
}

export type Order = Item & { sales: OrderSale[] }

export type OrderFilter = "to_ship" | "shipped" | "all"

export const isToShip = (o: Pick<Item, "status" | "shipped_at">) => o.status === "sold" && !o.shipped_at

export type OrderInfo = {
  soldOn: MarketplaceId | null
  buyer: string | null
  shipBy: string | null
  /** Ship-by date has passed and it still hasn't shipped. */
  late: boolean
  /** Where to see the order: eBay's order page, else the sold listing or the item's link. */
  url: string | null
}

export function orderInfo(o: Order, now = new Date()): OrderInfo {
  const sale = o.sales.find((s) => s.buyer || s.ship_by || s.external_order_id) ?? o.sales[0] ?? null
  const soldOn = o.sold_on ?? sale?.marketplace ?? null
  const shipBy = sale?.ship_by ?? null
  const listing = o.listings.find((l) => l.marketplace === soldOn && l.external_url)
  const url =
    sale?.marketplace === "ebay" && sale.external_order_id
      ? ebayOrderUrl(sale.external_order_id)
      : (listing?.external_url ?? o.link_url ?? null)
  return {
    soldOn,
    buyer: sale?.buyer ?? null,
    shipBy,
    late: isToShip(o) && !!shipBy && new Date(shipBy).getTime() < now.getTime(),
    url,
  }
}

const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0)

/**
 * Orders for one filter. To ship: most urgent first (by ship-by date, then oldest sale).
 * Otherwise newest sale first.
 */
export function filterOrders(orders: Order[], filter: OrderFilter): Order[] {
  if (filter === "to_ship") {
    const shipBy = (o: Order) => time(orderInfo(o).shipBy) || Number.MAX_SAFE_INTEGER
    return orders.filter(isToShip).sort((a, b) => shipBy(a) - shipBy(b) || time(a.sold_at) - time(b.sold_at))
  }
  const list = filter === "shipped" ? orders.filter((o) => !isToShip(o)) : [...orders]
  return list.sort((a, b) => time(b.sold_at) - time(a.sold_at))
}
