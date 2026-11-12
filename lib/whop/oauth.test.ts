import { describe, expect, it } from "vitest"
import { authorizeUrl, challengeFor, decodePkce, encodePkce, newPkce } from "./oauth"

describe("PKCE", () => {
  it("matches the RFC 7636 example challenge", () => {
    expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
  })
  it("round-trips through the cookie and rejects junk", () => {
    const p = newPkce()
    expect(decodePkce(encodePkce(p))).toEqual(p)
    expect(decodePkce(undefined)).toBeNull()
    expect(decodePkce("onlyone")).toBeNull()
    expect(decodePkce("a.b.c")).toBeNull()
  })
  it("builds the authorize URL", () => {
    const url = new URL(authorizeUrl("app_1", "https://x.test/auth/whop/callback", { state: "s", verifier: "v" }))
    expect(url.origin + url.pathname).toBe("https://api.whop.com/oauth/authorize")
    expect(url.searchParams.get("client_id")).toBe("app_1")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("scope")).toBe("openid profile email")
    expect(url.searchParams.get("state")).toBe("s")
  })
})
