import { verify } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { ebayConfig } from "@/lib/marketplaces/ebay/client"
import { challengeResponse } from "@/lib/marketplaces/ebay/deletion"
import { getAppToken } from "@/lib/marketplaces/ebay/oauth"
import { createAdminClient } from "@/lib/supabase/admin"

// eBay Marketplace Account Deletion notifications. eBay requires this endpoint
// before it issues production API keys.

function endpointUrl(request: NextRequest) {
  return process.env.EBAY_DELETION_ENDPOINT ?? `${request.nextUrl.origin}${request.nextUrl.pathname}`
}

/** Endpoint validation: eBay sends ?challenge_code and expects the hash back. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("challenge_code")
  const token = process.env.EBAY_VERIFICATION_TOKEN
  if (!code || !token) return NextResponse.json({ error: "Not configured" }, { status: 400 })
  return NextResponse.json({ challengeResponse: challengeResponse(code, token, endpointUrl(request)) })
}

const keyCache = new Map<string, string>()

async function signatureValid(body: string, header: string | null) {
  if (!header) return false
  try {
    const sig = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as { kid: string; signature: string }
    let key = keyCache.get(sig.kid)
    if (!key) {
      const res = await fetch(`${ebayConfig().api}/commerce/notification/v1/public_key/${sig.kid}`, {
        headers: { Authorization: `Bearer ${await getAppToken()}` },
        cache: "no-store",
      })
      if (!res.ok) return false
      key = ((await res.json()) as { key: string }).key
      keyCache.set(sig.kid, key)
    }
    return verify("sha1", Buffer.from(body), key, Buffer.from(sig.signature, "base64"))
  } catch {
    return false
  }
}

/** A seller deleted their eBay account: forget their tokens. */
export async function POST(request: NextRequest) {
  const body = await request.text()
  if (!(await signatureValid(body, request.headers.get("x-ebay-signature")))) {
    return new NextResponse(null, { status: 412 })
  }
  const userId = (JSON.parse(body) as { notification?: { data?: { userId?: string } } }).notification?.data?.userId
  if (userId) {
    await createAdminClient().from("marketplace_accounts").delete().eq("marketplace", "ebay").eq("external_user_id", userId)
  }
  return new NextResponse(null, { status: 204 })
}
