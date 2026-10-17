"use server"

import { z } from "zod"
import { requireUser } from "@/lib/supabase/server"
import { PHOTO_BUCKET, removeUnreferencedPhotos } from "@/lib/photos"
import { fail } from "./result"

export type PhotoUpload = { path: string; signedUrl: string }

/** Signed URLs the browser PUTs compressed photos to directly (skips the server-action body limit). */
export async function createPhotoUploads(
  count: number,
): Promise<{ ok: true; uploads: PhotoUpload[] } | { ok: false; error: string }> {
  try {
    const n = z.number().int().min(1).max(12).parse(count)
    const { supabase, userId } = await requireUser()
    const uploads: PhotoUpload[] = []
    for (let i = 0; i < n; i++) {
      const path = `${userId}/${crypto.randomUUID()}.jpg`
      const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUploadUrl(path)
      if (error) throw error
      uploads.push({ path, signedUrl: data.signedUrl })
    }
    return { ok: true, uploads }
  } catch (e) {
    return fail(e) as { ok: false; error: string }
  }
}

/** Short-lived URLs for photos picked in the form but not saved yet. */
export async function signPhotos(paths: string[]): Promise<string[]> {
  const { supabase } = await requireUser()
  const p = z.array(z.string().max(200)).max(12).parse(paths)
  if (!p.length) return []
  const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(p, 3600)
  return (data ?? []).map((d) => d.signedUrl ?? "")
}

/** Drop uploads the user removed or abandoned before saving. Files still used by an item are kept. */
export async function discardPhotos(paths: string[]): Promise<void> {
  const { supabase } = await requireUser()
  await removeUnreferencedPhotos(supabase, z.array(z.string().max(200)).max(24).parse(paths))
}
