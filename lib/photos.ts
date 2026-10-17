import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"

export const PHOTO_BUCKET = "item-photos"

/**
 * Delete storage objects that no item references any more. Partial sales copy
 * `photo_paths` onto the sold row, so a file can be shared by several items.
 */
export async function removeUnreferencedPhotos(supabase: SupabaseClient, paths: string[]) {
  if (!paths.length) return
  const { data } = await supabase.from("items").select("photo_paths").overlaps("photo_paths", paths)
  const used = new Set((data ?? []).flatMap((r) => r.photo_paths as string[]))
  const orphans = paths.filter((p) => !used.has(p))
  if (orphans.length) await supabase.storage.from(PHOTO_BUCKET).remove(orphans)
}

/** Batch-sign every photo path once; returns path → URL. */
export async function signPaths(supabase: SupabaseClient, paths: string[], expiresIn = 3600) {
  const unique = [...new Set(paths)]
  const out = new Map<string, string>()
  if (!unique.length) return out
  const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(unique, expiresIn)
  for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl)
  return out
}
