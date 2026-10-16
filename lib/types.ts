export type ItemStatus = "inventory" | "sold" | "returned"
export type Platform = "cash" | "card" | "mercari_depop" | "ebay" | "poshmark_amz" | "custom"

export type Item = {
  id: string
  seq: number
  title: string | null
  status: ItemStatus
  quantity: number
  cost_cents: number
  purchased_at: string
  store: string | null
  link_url: string | null
  haul_id: string | null
  sale_price_cents: number | null
  buyer_shipping_cents: number
  label_cost_cents: number
  fee_pct: number
  fee_fixed_cents: number
  platform: Platform | null
  sold_at: string | null
  returnable: boolean
  return_deadline: string | null
  created_at: string
}

export type Expense = {
  id: string
  kind: "expense" | "mileage"
  title: string
  category: string
  amount_cents: number
  spent_at: string
  miles: number | null
  rate_cents: number | null
}

export type Subscription = {
  id: string
  name: string
  amount_cents: number
  active: boolean
  started_at: string
}

export type Settings = {
  mileage_rate_cents: number
  default_return_days: number
}

export const EXPENSE_CATEGORIES = [
  "Packaging",
  "Shipping Supplies",
  "Software",
  "Platform Fees",
  "Storage",
  "Equipment",
  "Travel",
  "Meals",
  "Other",
] as const

export const DRIVE_PURPOSES = [
  "Garage Sale & Yard Sale Sourcing",
  "Thrift Store Sourcing",
  "Retail Arbitrage",
  "Post Office / Drop-off",
  "Supply Run",
  "Other Business Trip",
] as const
