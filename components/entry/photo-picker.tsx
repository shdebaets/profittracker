"use client"

import { Camera, Loader2, Star, Wand2, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { createPhotoUploads } from "@/app/(app)/actions/photos"
import { friendlyError, UserError } from "@/lib/errors"
import { compressImage } from "@/lib/image"
import { SUPABASE_KEY } from "@/lib/supabase/env"
import { cn } from "@/lib/utils"

export const MAX_PHOTOS = 12

export type Photo = { path: string; url: string }

async function putPhoto(signedUrl: string, blob: Blob) {
  const body = new FormData()
  body.append("cacheControl", "3600")
  body.append("", blob, "photo.jpg")
  const res = await fetch(signedUrl, { method: "PUT", body, headers: { apikey: SUPABASE_KEY, "x-upsert": "false" } })
  if (!res.ok) throw new UserError("Couldn't upload the photo. Check your connection and try again.")
}

/** Optional photo strip. The first photo is the cover; tap a photo to make it the cover. */
export function PhotoPicker({
  value, onChange, onUploaded, onUploadingChange,
}: {
  value: Photo[]
  /** Reorders and removals. */
  onChange: (photos: Photo[]) => void
  /**
   * Photos that finished uploading, for the caller to append. Separate from onChange because
   * an upload can finish after other edits, so it must not replace the list it started from.
   */
  onUploaded: (photos: Photo[]) => void
  /** How many photos are still uploading, so the caller can hold off saving. */
  onUploadingChange?: (count: number) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const room = MAX_PHOTOS - value.length - uploading
  // The list can change while a background is being removed; swap into the newest one.
  const latest = useRef(value)
  useEffect(() => {
    latest.current = value
  }, [value])

  useEffect(() => {
    onUploadingChange?.(uploading)
  }, [uploading, onUploadingChange])

  async function onPick(files: FileList | null) {
    const picked = Array.from(files ?? []).slice(0, Math.max(0, room))
    if (input.current) input.current.value = ""
    if (!picked.length) return
    if ((files?.length ?? 0) > picked.length) toast.message(`Up to ${MAX_PHOTOS} photos per item`)
    setUploading((n) => n + picked.length)
    try {
      const res = await createPhotoUploads(picked.length)
      if (!res.ok) throw new Error(res.error)
      const added: Photo[] = []
      await Promise.all(
        picked.map(async (file, i) => {
          const blob = await compressImage(file)
          await putPhoto(res.uploads[i].signedUrl, blob)
          added[i] = { path: res.uploads[i].path, url: URL.createObjectURL(blob) }
        }),
      )
      onUploaded(added)
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setUploading((n) => n - picked.length)
    }
  }

  const [cleaning, setCleaning] = useState<string | null>(null)

  /** Swap one photo for a white-background copy. The old file is cleaned up when the item is saved. */
  async function cleanUp(p: Photo) {
    if (cleaning) return
    setCleaning(p.path)
    const id = toast.loading("Removing the background. The first time takes a minute to load.")
    try {
      const { removeBackground } = await import("@/lib/bg-remove")
      const original = await (await fetch(p.url)).blob()
      const blob = await compressImage(new File([await removeBackground(original)], "photo.jpg", { type: "image/jpeg" }))
      const res = await createPhotoUploads(1)
      if (!res.ok) throw new Error(res.error)
      await putPhoto(res.uploads[0].signedUrl, blob)
      const next: Photo = { path: res.uploads[0].path, url: URL.createObjectURL(blob) }
      onChange(latest.current.map((x) => (x.path === p.path ? next : x)))
      toast.success("Background removed", { id })
    } catch (e) {
      console.error("[bg-remove]", e)
      toast.error("Couldn't remove the background on this device. Try it on a computer.", { id })
    } finally {
      setCleaning(null)
    }
  }

  const makeCover = (i: number) => onChange([value[i], ...value.filter((_, j) => j !== i)])
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i))

  return (
    <div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pt-2 pb-1 [scrollbar-width:none]">
        {value.map((p, i) => (
          <div key={p.path} className="relative size-20 shrink-0">
            <button
              type="button" onClick={() => makeCover(i)} aria-label={i ? "Make cover photo" : "Cover photo"}
              className={cn("block size-full overflow-hidden rounded-2xl border bg-muted", i === 0 && "ring-2 ring-brand")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="size-full object-cover" />
            </button>
            {i === 0 && (
              <span className="pointer-events-none absolute bottom-1 left-1 flex items-center gap-0.5 rounded-md bg-brand px-1.5 py-0.5 text-[10px] font-bold text-ink">
                <Star className="size-2.5" /> Cover
              </span>
            )}
            <button
              type="button" onClick={() => remove(i)} aria-label="Remove photo"
              className="absolute -top-1.5 -right-1.5 grid size-6 place-items-center rounded-full bg-ink text-white shadow"
            >
              <X className="size-3.5" />
            </button>
            <button
              type="button" onClick={() => cleanUp(p)} disabled={!!cleaning} aria-label="Remove background"
              title="Remove background"
              className="absolute right-1 bottom-1 grid size-6 place-items-center rounded-full bg-white/90 text-ink shadow disabled:opacity-60"
            >
              {cleaning === p.path ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
            </button>
          </div>
        ))}
        {Array.from({ length: uploading }, (_, i) => (
          <div key={`u${i}`} className="grid size-20 shrink-0 place-items-center rounded-2xl border bg-muted">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ))}
        {room > 0 && (
          <button
            type="button" onClick={() => input.current?.click()}
            className="flex size-20 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed bg-card text-xs font-semibold text-muted-foreground"
          >
            <Camera className="size-5" />
            {value.length ? "Add" : "Add photos"}
          </button>
        )}
      </div>
      <input
        ref={input} type="file" accept="image/*" multiple hidden
        onChange={(e) => onPick(e.target.files)}
      />
    </div>
  )
}
