import type { Profile } from "./profile"

export type ResearchProduct = {
  id: string
  query: string
  name: string
  image_url: string | null
  profile: Profile
  examples: { title: string; decision: string }[]
  status: "active" | "paused"
  last_refresh_at: string | null
  last_status: string | null
  last_error: string | null
  sold_collected_at: string | null
  created_by: string | null
  created_at: string
}

export type ListingStatus = "pending" | "counted" | "review" | "rejected"
export type DetailsState = "pending" | "available" | "unavailable"

export type Listing = {
  id: string
  product_id: string
  item_id: string
  legacy_id: string | null
  title: string
  price: number | null
  shipping: number | null
  currency: string | null
  condition: string | null
  category: string | null
  seller: string | null
  seller_feedback: number | null
  buying_options: string[]
  image_url: string | null
  url: string | null
  matched_keywords: string[]
  status: ListingStatus
  version_key: string | null
  reason: string | null
  confidence: number | null
  judged_by: string | null
  judge_attempts: number
  presale: boolean
  best_offer: boolean
  start_date: string | null
  end_date: string | null
  sold_qty: number | null
  avail_qty: number | null
  specifics: Record<string, string> | null
  details_state: DetailsState
  details_fetched_at: string | null
  live: boolean
  first_seen: string
  last_seen: string
  search_run_id: string | null
}

export type Sale = {
  id: number
  product_id: string
  external_id: string
  listing_id: string | null
  source: "collector" | "tracker"
  version_key: string | null
  verdict: string
  reason: string | null
  judge_attempts: number
  human_decision: boolean
  sold_on: string
  title: string | null
  url: string | null
  price: number | null
  shipping: number | null
  best_offer: boolean
  presale: boolean
  format: string | null
  condition: string | null
  seller: string | null
  variants_matched: string[]
  qty: number
  units: number
  volume_days: { day: string; qty: number }[]
  listing_created_at: string | null
  specifics: Record<string, string> | null
  details_state: DetailsState
  collected_at: string | null
}

export type RunProgress = {
  search?: { done: number; total: number }
  variants?: { keyword: string; reported: number; pages: number; unique: number; offset: number; done: boolean }[]
  pulled?: number
  judged?: number
  toJudge?: number
  phase1Done?: boolean
  details?: { done: number; total: number }
  counted?: number
  review?: number
  rejected?: number
}

export type ResearchRun = {
  id: string
  product_id: string
  kind: "track" | "sold"
  workflow_run_id: string | null
  status: "running" | "done" | "error" | "paused" | "superseded"
  step: string
  progress: RunProgress
  error: string | null
  created_at: string
  updated_at: string
}
