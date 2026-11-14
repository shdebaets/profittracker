import { NextResponse, type NextRequest } from "next/server"
import { verifyUnsubscribe } from "@/lib/email/send"
import { createAdminClient } from "@/lib/supabase/admin"

const COLUMN = { recap: "email_recap", tax: "email_tax_reminders" } as const

async function unsubscribe(request: NextRequest) {
  const p = request.nextUrl.searchParams
  const userId = p.get("u") ?? ""
  const kind = p.get("k") ?? ""
  if (!/^[0-9a-f-]{36}$/.test(userId) || !verifyUnsubscribe(userId, kind, p.get("s") ?? "")) {
    return new NextResponse("This unsubscribe link isn't valid.", { status: 400 })
  }
  // The signed link proves which user and email type; scoped to that user.
  const { error } = await createAdminClient().from("settings").upsert({ user_id: userId, [COLUMN[kind]]: false }, { onConflict: "user_id" })
  if (error) return new NextResponse("Couldn't unsubscribe right now. Try again in a minute.", { status: 500 })
  return new NextResponse(
    `<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:Arial,sans-serif;padding:32px"><p>You're unsubscribed from FlipLedger ${kind === "recap" ? "weekly recaps" : "tax reminders"}. Turn them back on any time in Settings.</p></body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  )
}

// GET: the link in the email. POST: one-click unsubscribe from mail apps (List-Unsubscribe-Post).
export const GET = unsubscribe
export const POST = unsubscribe
