"use client"

import { Camera, Loader2, Star, WandSparkles, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { createPhotoUploads } from "@/app/(app)/actions/photos"
import { removeBackground } from "@/lib/background"
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
  value, onChange, onUploaded, onReplace, onUploadingChange,
}: {
  value: Photo[]
  /** Reorders and removals. */
  onChange: (photos: Photo[]) => void
  /**
   * Photos that finished uploading, for the caller to append. Separate from onChange because
   * an upload can finish after other edits, so it must not replace the list it started from.
   */
  onUploaded: (photos: Photo[]) => void
  /**
   * Swap `from` for `to` where it now sits (used by background removal and its undo).
   * `fresh` means `to` was just uploaded. Returns false if `from` is gone, so nothing changed.
   */
  onReplace?: (from: Photo, to: Photo, fresh: boolean) => boolean
  /** How many photos are still uploading, so the caller can hold off saving. */
  onUploadingChange?: (count: number) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  // Paths whose background is being removed.
  const [cutting, setCutting] = useState<string[]>([])
  const room = MAX_PHOTOS - value.length - uploading
  // The latest onReplace, for a cutout that finishes after the form re-rendered.
  const replace = useRef(onReplace)
  useEffect(() => {
    replace.current = onReplace
  })

  useEffect(() => {
    onUploadingChange?.(uploading + cutting.length)
  }, [uploading, cutting.length, onUploadingChange])

  async function cutOut(photo: Photo) {
    setCutting((c) => [...c, photo.path])
    try {
      const source = await fetch(photo.url).then((r) => {
        if (!r.ok) throw new UserError("Couldn't load the photo. Check your connection and try again.")
        return r.blob()
      })
      const [blob, res] = await Promise.all([removeBackground(source), createPhotoUploads(1)])
      if (!res.ok) throw new Error(res.error)
      await putPhoto(res.uploads[0].signedUrl, blob)
      const cut: Photo = { path: res.uploads[0].path, url: URL.createObjectURL(blob) }
      if (!replace.current?.(photo, cut, true)) return
      toast.success("Background removed", {
        duration: 8000,
        action: { label: "Undo", onClick: () => replace.current?.(cut, photo, false) },
      })
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setCutting((c) => c.filter((p) => p !== photo.path))
    }
  }

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
            {cutting.includes(p.path) && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-2xl bg-white/70">
                <Loader2 className="size-5 animate-spin text-ink" />
              </div>
            )}
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
            {onReplace && (
              <button
                type="button" onClick={() => cutOut(p)} disabled={cutting.includes(p.path)}
                aria-label="Remove background" title="Remove background"
                className="absolute right-1 bottom-1 grid size-7 place-items-center rounded-full bg-white text-ink shadow disabled:opacity-50"
              >
                <WandSparkles className="size-3.5" />
              </button>
            )}
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
      {onReplace && value.length > 0 && (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <WandSparkles className="size-3 shrink-0" />
          Tap the wand to remove a background. Works best on plain backgrounds.
        </p>
      )}
      <input
        ref={input} type="file" accept="image/*" multiple hidden
        onChange={(e) => onPick(e.target.files)}
      />
    </div>
  )
}
