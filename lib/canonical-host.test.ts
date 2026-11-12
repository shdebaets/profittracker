import { describe, expect, it } from "vitest"
import { canonicalRedirect } from "./canonical-host"

const old = "profittracker-iye3.vercel.app"
const canon = "profit.emoneydeals.com"
const at = (path: string) => new URL(`https://${old}${path}`)

describe("canonicalRedirect", () => {
  it("sends the old host to the new one, keeping path and query", () => {
    expect(canonicalRedirect(at("/inventory?tab=sold"), old, canon, "production")?.href).toBe(
      "https://profit.emoneydeals.com/inventory?tab=sold",
    )
  })
  it("does nothing until CANONICAL_HOST is set", () => {
    expect(canonicalRedirect(at("/"), old, undefined, "production")).toBeNull()
  })
  it("leaves previews, the new host and other hosts alone", () => {
    expect(canonicalRedirect(at("/"), "profittracker-git-x.vercel.app", canon, "preview")).toBeNull()
    expect(canonicalRedirect(new URL(`https://${canon}/`), canon, canon, "production")).toBeNull()
    expect(canonicalRedirect(new URL("http://localhost:3000/"), "localhost:3000", canon, "production")).toBeNull()
  })
  it("leaves /api on the old host", () => {
    expect(canonicalRedirect(at("/api/marketplaces/ebay/account-deletion"), old, canon, "production")).toBeNull()
    expect(canonicalRedirect(at("/api/p/1/2/a.jpg"), old, canon, "production")).toBeNull()
  })
})
