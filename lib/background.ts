import type { InferenceSession } from "onnxruntime-web"
import { UserError } from "./errors"
import { canvasToJpeg, fitWithin } from "./image"

/**
 * One-tap background removal, entirely in the browser. The model is U²-Netp
 * (salient object detection, Apache-2.0, github.com/xuebinqin/U-2-Net; ONNX
 * export from rembg), about 4.6 MB in public/models. It and onnxruntime-web
 * load on the first tap only and the browser caches them after that.
 */
export const MODEL_URL = "/models/u2netp.onnx"
/** The model's fixed input size. */
export const MODEL_SIZE = 320
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

/**
 * RGBA pixels (MODEL_SIZE²) → the model's 1×3×H×W input: each channel scaled
 * by the brightest value in the image, then ImageNet-normalized (as rembg does).
 */
export function toModelInput(rgba: Uint8ClampedArray): Float32Array {
  const n = rgba.length / 4
  let max = 1
  for (let i = 0; i < rgba.length; i++) if (i % 4 !== 3 && rgba[i] > max) max = rgba[i]
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) out[c * n + i] = (rgba[i * 4 + c] / max - MEAN[c]) / STD[c]
  }
  return out
}

/**
 * The model's raw saliency map → alpha 0–255. Min-max normalized, then a soft
 * threshold so faint background haze goes fully white and the item fully opaque.
 */
export function toAlpha(pred: ArrayLike<number>, low = 0.15, high = 0.85): Uint8ClampedArray {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < pred.length; i++) {
    if (pred[i] < min) min = pred[i]
    if (pred[i] > max) max = pred[i]
  }
  const range = max - min || 1
  const out = new Uint8ClampedArray(pred.length)
  for (let i = 0; i < pred.length; i++) {
    const v = (pred[i] - min) / range
    out[i] = Math.round(Math.min(1, Math.max(0, (v - low) / (high - low))) * 255)
  }
  return out
}

let session: Promise<{ ort: typeof import("onnxruntime-web"); session: InferenceSession }> | null = null

function loadModel() {
  session ??= (async () => {
    const ort = await import("onnxruntime-web/wasm")
    // Our own copy of the runtime (scripts/copy-ort-wasm.mjs), one thread so it
    // works without cross-origin isolation.
    ort.env.wasm.wasmPaths = `/models/ort/${ort.env.versions.web}/`
    ort.env.wasm.numThreads = 1
    return { ort, session: await ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] }) }
  })().catch((e) => {
    session = null // let the next tap try again
    throw e
  })
  return session
}

function canvas(width: number, height: number) {
  const c = document.createElement("canvas")
  c.width = width
  c.height = height
  const ctx = c.getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new UserError("Your browser couldn't process this photo. Try a different one.")
  return { c, ctx }
}

/** Cut the item out of a photo and put it on plain white. Returns a JPEG like every stored photo. */
export async function removeBackground(photo: Blob): Promise<Blob> {
  const [{ ort, session: model }, bitmap] = await Promise.all([
    loadModel(),
    createImageBitmap(photo, { imageOrientation: "from-image" }).catch(() => {
      throw new UserError("This photo couldn't be read. Try a different one.")
    }),
  ])
  try {
    const small = canvas(MODEL_SIZE, MODEL_SIZE)
    small.ctx.drawImage(bitmap, 0, 0, MODEL_SIZE, MODEL_SIZE)
    const pixels = small.ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE)
    const input = new ort.Tensor("float32", toModelInput(pixels.data), [1, 3, MODEL_SIZE, MODEL_SIZE])
    const result = await model.run({ [model.inputNames[0]]: input })
    const alpha = toAlpha(result[model.outputNames[0]].data as Float32Array)

    // The mask as a transparent image, scaled up by drawImage's smoothing.
    for (let i = 0; i < alpha.length; i++) pixels.data[i * 4 + 3] = alpha[i]
    small.ctx.putImageData(pixels, 0, 0)

    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const cut = canvas(width, height)
    cut.ctx.drawImage(bitmap, 0, 0, width, height)
    cut.ctx.globalCompositeOperation = "destination-in"
    cut.ctx.imageSmoothingQuality = "high"
    cut.ctx.drawImage(small.c, 0, 0, width, height)

    const out = canvas(width, height)
    out.ctx.fillStyle = "#fff"
    out.ctx.fillRect(0, 0, width, height)
    out.ctx.drawImage(cut.c, 0, 0)
    return await canvasToJpeg(out.c)
  } finally {
    bitmap.close()
  }
}
