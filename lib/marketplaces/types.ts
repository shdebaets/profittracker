import type { Listing } from "@/lib/types"

/** A marketplace we can drive through its API. Every call acts for listing.user_id. */
export type ApiAdapter = {
  /** End the listing on the marketplace. */
  end(listing: Listing): Promise<void>
  /** Change the quantity still available (multi-unit lots after a partial sale elsewhere). */
  setQuantity(listing: Listing, quantity: number): Promise<void>
}
