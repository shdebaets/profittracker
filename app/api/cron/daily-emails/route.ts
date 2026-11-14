import { NextResponse, type NextRequest } from "next/server"
import { runDailyEmails } from "@/lib/email/jobs"
import { createAdminClient } from "@/lib/supabase/admin"

export const maxDuration = 300

/** Vercel Cron, daily: Sunday recaps and quarterly tax reminders. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return NextResponse.json(await runDailyEmails(createAdminClient()))
}
