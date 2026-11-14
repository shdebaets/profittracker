// Background removal for item photos, run in the seller's browser (free, no API key, photos never
// leave the device for this step). Model: ORMBG, Apache-2.0. Downloaded once (~90 MB) and cached by
// the browser. Loaded only when someone taps "Remove background".
"use client"

type Segmenter = (input: string) => Promise<{ toCanvas: () => HTMLCanvasElement | OffscreenCanvas }[]>

// The browser-patched export first (onnxruntime-web can't run the upstream MaxPool settings),
// then the upstream export as a fallback.
const MODELS: { id: string; dtype: "fp16" | "q8" }[] = [
  { id: process.env.NEXT_PUBLIC_BG_MODEL || "d30social/ormbg-ortweb", dtype: "fp16" },
  { id: "onnx-community/ormbg-ONNX", dtype: "q8" },
]

let loading: Promise<Segmenter> | null = null

async function segmenter(): Promise<Segmenter> {
  loading ??= (async () => {
    const { pipeline } = await import("@huggingface/transformers")
    const device = "gpu" in navigator ? "webgpu" : "wasm"
    let last: unknown
    for (const m of MODELS) {
      try {
        return (await pipeline("background-removal", m.id, { dtype: m.dtype, device })) as unknown as Segmenter
      } catch (e) {
        last = e
        console.warn("[bg-remove] model failed", m.id, e)
      }
    }
    throw last
  })().catch((e) => {
    loading = null
    throw e
  })
  return loading
}

/** Cuts the item out and puts it on plain white (what marketplaces like), as a JPEG. */
export async function removeBackground(src: Blob): Promise<Blob> {
  const seg = await segmenter()
  const url = URL.createObjectURL(src)
  try {
    const [cut] = await seg(url)
    const cutout = cut.toCanvas()
    const canvas = document.createElement("canvas")
    canvas.width = cutout.width
    canvas.height = cutout.height
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(cutout as CanvasImageSource, 0, 0)
    return await new Promise<Blob>((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error("encode failed"))), "image/jpeg", 0.9))
  } finally {
    URL.revokeObjectURL(url)
  }
}
