import { UserError } from "./errors"

export const MAX_PHOTO_EDGE = 1600

/** Scale (w, h) down so the long edge is at most `max`; never upscales. */
export function fitWithin(w: number, h: number, max = MAX_PHOTO_EDGE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h))
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

/**
 * Resize a picked photo to a ~300 KB JPEG in the browser. createImageBitmap
 * decodes iPhone HEIC (Safari) and honours EXIF orientation.
 */
export async function compressImage(file: File, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new UserError(`"${file.name}" couldn't be read. Try a JPG or PNG, or take the photo again.`)
  })
  const { width, height } = fitWithin(bitmap.width, bitmap.height)
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new UserError("Your browser couldn't process this photo. Try a different one.")
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality))
  if (!blob) throw new UserError("Your browser couldn't process this photo. Try a different one.")
  return blob
}
