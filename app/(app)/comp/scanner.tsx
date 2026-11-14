"use client"

import { X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> }

/**
 * Camera barcode scanner. Uses the browser's BarcodeDetector where it exists (Chrome on Android),
 * else ZXing (iPhone Safari). Calls onCode once with the first UPC/EAN it reads.
 */
export function Scanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const done = useRef(false)

  useEffect(() => {
    let stop = () => {}
    let cancelled = false
    const found = (code: string) => {
      if (done.current || !/^\d{8,14}$/.test(code)) return
      done.current = true
      navigator.vibrate?.(60)
      onCode(code)
    }
    ;(async () => {
      try {
        const BD = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector
        if (BD) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
          if (cancelled) return stream.getTracks().forEach((t) => t.stop())
          const v = video.current!
          v.srcObject = stream
          await v.play()
          const detector = new BD({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] })
          let raf = 0
          const tick = async () => {
            if (cancelled || done.current) return
            try {
              const [hit] = await detector.detect(v)
              if (hit) found(hit.rawValue)
            } catch {
              // frame not ready yet
            }
            raf = requestAnimationFrame(tick)
          }
          raf = requestAnimationFrame(tick)
          stop = () => {
            cancelAnimationFrame(raf)
            stream.getTracks().forEach((t) => t.stop())
          }
        } else {
          const { BrowserMultiFormatReader } = await import("@zxing/browser")
          const reader = new BrowserMultiFormatReader()
          const controls = await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, video.current!, (result) => {
            if (result) found(result.getText())
          })
          if (cancelled) return controls.stop()
          stop = () => controls.stop()
        }
      } catch {
        setError("Couldn't open the camera. Allow camera access for this site, or type the barcode below.")
      }
    })()
    return () => {
      cancelled = true
      stop()
    }
  }, [onCode])

  return (
    <div className="relative overflow-hidden rounded-3xl bg-ink">
      <video ref={video} playsInline muted className="aspect-[4/3] w-full object-cover" />
      <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-2xl border-2 border-brand/80" />
      <button onClick={onClose} aria-label="Close scanner" className="absolute top-3 right-3 grid size-10 place-items-center rounded-full bg-black/50 text-white">
        <X className="size-5" />
      </button>
      {error && <p className="absolute inset-x-3 bottom-3 rounded-xl bg-black/70 p-3 text-sm text-white">{error}</p>}
    </div>
  )
}
