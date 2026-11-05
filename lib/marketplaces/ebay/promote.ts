import "server-only"
import { UserError } from "@/lib/errors"
import type { EbaySettings } from "@/lib/types"
import { EBAY_MARKETPLACE_ID, EbayError, ebayFetch } from "./client"
import { formatAdRate } from "./mapping"

// eBay Promoted Listings, cost per sale ("general" strategy): one manual campaign per seller
// that FlipLedger adds each listing to at its own ad rate. eBay charges the rate only when
// a sale comes through the ad. The campaign is ordinary, so sellers can see and edit it on eBay.

export const CAMPAIGN_NAME = "FlipLedger promoted listings"

type Campaign = { campaignId: string; campaignName: string; campaignStatus?: string }
type AdResult = {
  listingId?: string
  statusCode?: number
  errors?: { errorId?: number; message?: string; longMessage?: string; parameters?: { name: string; value: string }[] }[]
}

const usable = (c: Campaign | null): c is Campaign => !!c && !["ENDED", "ENDING"].includes(c.campaignStatus ?? "")

async function campaignById(token: string, id: string): Promise<Campaign | null> {
  try {
    return await ebayFetch<Campaign>(token, `/sell/marketing/v1/ad_campaign/${encodeURIComponent(id)}`)
  } catch (e) {
    if (e instanceof EbayError && e.status === 404) return null
    throw e
  }
}

async function campaignByName(token: string, name: string): Promise<Campaign | null> {
  try {
    return await ebayFetch<Campaign>(
      token,
      `/sell/marketing/v1/ad_campaign/get_campaign_by_name?campaign_name=${encodeURIComponent(name)}`,
    )
  } catch (e) {
    if (e instanceof EbayError && (e.status === 404 || e.status === 400)) return null
    throw e
  }
}

/** The seller's FlipLedger campaign: the saved one, else one with our name, else a new one. */
export async function ensureCampaign(token: string, settings: EbaySettings, rate: number): Promise<string> {
  if (settings.campaignId) {
    const saved = await campaignById(token, settings.campaignId)
    if (usable(saved)) return saved.campaignId
  }
  const named = await campaignByName(token, CAMPAIGN_NAME)
  if (usable(named)) return named.campaignId

  // Names must be unique per seller, including ended campaigns, so a replacement gets the date.
  const name = named ? `${CAMPAIGN_NAME} ${new Date().toISOString().slice(0, 10)}` : CAMPAIGN_NAME
  try {
    // 201 with only a Location header, so look the new campaign up by name.
    await ebayFetch(token, "/sell/marketing/v1/ad_campaign", {
      body: {
        campaignName: name,
        marketplaceId: EBAY_MARKETPLACE_ID,
        startDate: new Date().toISOString(),
        fundingStrategy: { fundingModel: "COST_PER_SALE", bidPercentage: formatAdRate(rate) },
      },
    })
  } catch (e) {
    // 409: a campaign with this name already exists (e.g. a second tap racing the first).
    if (!(e instanceof EbayError) || e.status !== 409) throw e
  }
  const created = await campaignByName(token, name)
  if (!usable(created)) throw new UserError("eBay didn't create the promoted listings campaign. Try again in a minute.")
  return created.campaignId
}

async function adCall(token: string, campaignId: string, op: "bulk_create_ads_by_listing_id" | "bulk_update_ads_bid_by_listing_id", listingId: string, rate: number) {
  const r = await ebayFetch<{ responses?: AdResult[] }>(
    token,
    `/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/${op}`,
    { body: { requests: [{ listingId, bidPercentage: formatAdRate(rate) }] } },
  )
  return r.responses?.find((x) => x.listingId === listingId) ?? r.responses?.[0] ?? {}
}

const ok = (r: AdResult) => !!r.statusCode && r.statusCode >= 200 && r.statusCode < 300

/**
 * Promote one live listing at `rate` percent. Creates the ad, or updates its rate when
 * the listing is already in our campaign. Returns the campaign id so the caller can save it.
 */
export async function promoteListing(token: string, settings: EbaySettings, listingId: string, rate: number) {
  try {
    return await promote(token, settings, listingId, rate)
  } catch (e) {
    // Tag eBay errors so friendlyError explains them as a promotion problem, not a listing one.
    if (e instanceof EbayError && !/^promoted listing:/i.test(e.message))
      throw new EbayError(`Promoted listing: ${e.message}`, e.status, e.errors)
    throw e
  }
}

async function promote(token: string, settings: EbaySettings, listingId: string, rate: number) {
  const campaignId = await ensureCampaign(token, settings, rate)
  const created = await adCall(token, campaignId, "bulk_create_ads_by_listing_id", listingId, rate)
  if (ok(created)) return { campaignId }

  // Already promoted in this campaign (e.g. promoting again at a new rate): change the rate instead.
  const updated = await adCall(token, campaignId, "bulk_update_ads_bid_by_listing_id", listingId, rate).catch(() => null)
  if (updated && ok(updated)) return { campaignId }

  const errors = created.errors ?? []
  const msg = errors[0]?.longMessage || errors[0]?.message || "eBay couldn't promote this listing."
  throw new EbayError(`Promoted listing: ${msg}`, created.statusCode ?? 400, errors)
}
