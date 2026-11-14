// Browser-side: compress a receipt photo and upload it to the seller's folder in `item-photos`.
import { createPhotoUploads } from "@/app/(app)/actions/photos"
import { compressImage } from "@/lib/image"
import { SUPABASE_KEY } from "@/lib/supabase/env"

/** Returns the stored path and a local preview URL. Throws with a message written for people. */
export async function uploadReceipt(file: File): Promise<{ path: string; url: string }> {
  const res = await createPhotoUploads(1)
  if (!res.ok) throw new Error(res.error)
  const blob = await compressImage(file)
  const body = new FormData()
  body.append("cacheControl", "3600")
  body.append("", blob, "receipt.jpg")
  const put = await fetch(res.uploads[0].signedUrl, { method: "PUT", body, headers: { apikey: SUPABASE_KEY, "x-upsert": "false" } })
  if (!put.ok) throw new Error("Couldn't upload the receipt. Check your connection and try again.")
  return { path: res.uploads[0].path, url: URL.createObjectURL(blob) }
}
