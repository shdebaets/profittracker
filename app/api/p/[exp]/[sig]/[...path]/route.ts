import type { NextRequest } from "next/server"
import { verifyPhotoLink } from "@/lib/photo-links"
import { PHOTO_BUCKET } from "@/lib/photos"
import { createAdminClient } from "@/lib/supabase/admin"

/** Serves an item photo for a short signed link (see lib/photo-links.ts). Public: the signature is the auth. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/p/[exp]/[sig]/[...path]">) {
  const { exp, sig, path } = await ctx.params
  const filePath = path.join("/")
  if (!verifyPhotoLink(exp, sig, filePath)) return new Response("Not found", { status: 404 })

  const { data, error } = await createAdminClient().storage.from(PHOTO_BUCKET).download(filePath)
  if (error || !data) return new Response("Not found", { status: 404 })
  return new Response(data, {
    headers: {
      "Content-Type": data.type || "image/jpeg",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  })
}
