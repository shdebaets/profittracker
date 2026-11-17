import { NextResponse, type NextRequest } from "next/server"
import { refreshUnitReadings } from "@/lib/comps/readings"

export const maxDuration = 300

/** Vercel Cron, daily: today's sold-count reading for listings comps looked at in the last week. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const started = Date.now()
  try {
    const result = await refreshUnitReadings({ deadline: started + 270_000 })
    console.log("[comp readings]", JSON.stringify(result))
    return NextResponse.json(result)
  } catch (e) {
    console.error("[comp readings]", e)
    return NextResponse.json({ error: "readings failed" }, { status: 500 })
  }
}
