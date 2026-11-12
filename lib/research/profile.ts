// Product profile: what one tracked product is, its versions, the words that rule
// listings out, and the rule-based checks that run before any AI call. Browser-safe.

export type Version = {
  key: string
  name: string
  aliases: string[]
  abbreviations: string[]
  color_hints: string[]
  price_low?: number | null
  price_high?: number | null
}

export type Exclusion = { label: string; words: string[] }

/** A sibling edition that is NOT tracked (e.g. "Day" when only "Night" is), used to reject its listings. */
export type OtherEdition = { name: string; words: string[] }

export type Profile = {
  canonical_name: string
  brand?: string
  category?: string
  upc?: string | null
  release_date?: string | null
  versions: Version[]
  other_editions?: OtherEdition[]
  keywords: string[]
  exclusions: Exclusion[]
}

const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const wordRe = (w: string) => new RegExp(`(^|[^a-z0-9])${esc(w.toLowerCase())}($|[^a-z0-9])`)
export const mentions = (text: string, words: string[]) => {
  const t = text.toLowerCase()
  return words.map((w) => w.trim()).filter((w) => w.length > 1).some((w) => wordRe(w).test(t))
}

export const versionWords = (v: Version) =>
  [v.name, ...(v.aliases ?? []), ...(v.color_hints ?? [])].map((w) => w.trim()).filter((w) => w.length > 2)

export function matchExclusion(title: string, profile: Profile): Exclusion | null {
  const t = ` ${title.toLowerCase()} `
  for (const ex of profile.exclusions ?? []) {
    for (const w of ex.words ?? []) {
      const word = w.trim().toLowerCase()
      if (word && t.includes(word)) return ex
    }
  }
  return null
}

/**
 * For a product tracked as one edition: a title naming another edition is rejected,
 * one naming both is a multi-box lot, and one naming neither needs item specifics.
 * Returns null when the title clearly names the tracked edition (or the rule doesn't apply).
 */
export function editionRule(title: string, profile: Profile): { verdict: string; reason: string } | null {
  const others = (profile.other_editions ?? []).filter((o) => o.words?.length)
  const version = profile.versions[0]
  if (profile.versions.length !== 1 || !version || !others.length) return null
  const own = mentions(title, versionWords(version))
  const other = others.find((o) => mentions(title, [o.name, ...o.words]))
  if (own && other) return { verdict: "reject", reason: "multiple editions" }
  if (other) return { verdict: "reject", reason: `other version: ${other.name}` }
  if (!own) return { verdict: "unknown_version", reason: "Version needs item specifics" }
  return null
}

const PRESALE =
  /\b(pre[ -]?sale|pre[ -]?order|preorder|confirmed|ships?\s+\d{1,2}\/\w+|ships?\s+(in|on|by)\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i
export const isPresale = (title: string) => PRESALE.test(title)

/** eBay search URLs for the product (live or sold), with exclusion words as negatives. */
export function ebaySearchUrl(profile: Profile, sold: boolean) {
  const base = profile.keywords?.[0] || profile.canonical_name
  const negatives = new Set<string>()
  for (const ex of profile.exclusions ?? [])
    for (const w of ex.words ?? []) {
      const word = w.trim().toLowerCase()
      if (word && !word.includes(" ") && word.length > 2 && !base.toLowerCase().includes(word)) negatives.add(word)
    }
  const neg = [...negatives].slice(0, 12).map((w) => `-${w}`).join(" ")
  const q = encodeURIComponent(`${base} ${neg}`.trim()).replace(/%20/g, "+")
  return `https://www.ebay.com/sch/i.html?_nkw=${q}${sold ? "&LH_Sold=1&LH_Complete=1" : ""}`
}
