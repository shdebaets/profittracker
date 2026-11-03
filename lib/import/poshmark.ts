import type { ItemCondition } from "@/lib/marketplaces/registry"
import type { ImportCandidate } from "./plan"

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
/** 48 listings a page, so this covers closets up to ~580 live listings. */
const MAX_PAGES = 12
export const POSHMARK_PHOTO_HOST = "di2ponv0v5otw.cloudfront.net"

const CONDITIONS: Record<string, ItemCondition> = { nwt: "new_with_tags", ret: "new_with_tags", nwot: "new", uln: "like_new", ug: "good", uf: "fair" }

/** A Poshmark username from what the seller typed: "name", "@name" or their closet link. */
export function poshmarkUsername(input: string): string | null {
  const s = input.trim().replace(/^@/, "")
  const fromLink = s.match(/poshmark\.com\/closet\/([^/?#]+)/i)?.[1]
  const name = fromLink ?? s
  return /^[A-Za-z0-9_.-]{1,40}$/.test(name) ? name : null
}

/**
 * The JSON value that starts right after `marker` in `html`, or null. Pages put more
 * script after it on the same line, so this matches braces instead of splitting.
 */
export function jsonAfter(html: string, marker: string): unknown {
  const start = html.indexOf(marker)
  if (start < 0) return null
  const from = start + marker.length
  let depth = 0
  let inString = false
  for (let i = from; i < html.length; i++) {
    const ch = html[i]
    if (inString) {
      if (ch === "\\") i++
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === "{" || ch === "[") depth++
    else if (ch === "}" || ch === "]") {
      if (--depth === 0) {
        try {
          return JSON.parse(html.slice(from, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

type PoshPost = {
  id?: string
  title?: string
  description?: string
  brand?: string
  size?: string
  size_obj?: { display?: string }
  condition?: string
  price_amount?: { val?: string }
  inventory?: { status?: string }
  cover_shot?: { path_large?: string; url?: string }
  picture_url?: string
}

const slug = (t: string) => t.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "listing"

/** Live listings on one closet page, and the cursor for the next page (null on the last). */
export function parsePoshmarkCloset(html: string): { listings: ImportCandidate[]; nextMaxId: string | null } | null {
  const state = jsonAfter(html, "__INITIAL_STATE__=") as { $_closet?: { listingsPostData?: { data?: PoshPost[]; more?: { next_max_id?: string } } } } | null
  const posts = state?.$_closet?.listingsPostData
  if (!posts?.data) return null
  const listings: ImportCandidate[] = []
  for (const p of posts.data) {
    if (!p.id || !/^[0-9a-f]{24}$/.test(p.id) || !p.title || p.inventory?.status !== "available") continue
    const price = Number(p.price_amount?.val)
    const photo = p.cover_shot?.path_large ? `https://${POSHMARK_PHOTO_HOST}/${p.cover_shot.path_large}` : (p.cover_shot?.url ?? p.picture_url ?? null)
    listings.push({
      marketplace: "poshmark",
      externalId: p.id,
      url: `https://poshmark.com/listing/${slug(p.title)}-${p.id}`,
      title: p.title.trim().slice(0, 200),
      description: (p.description ?? "").trim().slice(0, 5000),
      priceCents: Number.isFinite(price) && price > 0 ? Math.round(price * 100) : null,
      brand: (p.brand ?? "").trim().slice(0, 100),
      size: (p.size_obj?.display ?? p.size ?? "").trim().slice(0, 50),
      condition: CONDITIONS[p.condition ?? ""] ?? null,
      photoUrl: photo,
    })
  }
  return { listings, nextMaxId: posts.more?.next_max_id || null }
}

/**
 * Every live listing in a public Poshmark closet. Throws if the first page can't be read.
 * Closets are ordered by last share, so a listing shared mid-read can shift pages: it
 * shows up twice (dropped here) and another can be missed (the next import catches it).
 */
export async function fetchPoshmarkCloset(username: string, fetcher: typeof fetch = fetch): Promise<ImportCandidate[]> {
  const all = new Map<string, ImportCandidate>()
  let maxId: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `https://poshmark.com/closet/${encodeURIComponent(username)}${maxId ? `?max_id=${encodeURIComponent(maxId)}` : ""}`
    const res = await fetcher(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html", "accept-language": "en-US" },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 404) throw new PoshmarkClosetError("not_found")
    if (!res.ok) throw new PoshmarkClosetError("blocked")
    const parsed = parsePoshmarkCloset(await res.text())
    if (!parsed) {
      if (page === 0) throw new PoshmarkClosetError("blocked")
      break
    }
    for (const l of parsed.listings) if (!all.has(l.externalId)) all.set(l.externalId, l)
    if (!parsed.nextMaxId) break
    maxId = parsed.nextMaxId
  }
  return [...all.values()]
}

export class PoshmarkClosetError extends Error {
  reason: "not_found" | "blocked"
  constructor(reason: "not_found" | "blocked") {
    super(`Poshmark closet ${reason}`)
    this.reason = reason
  }
}
