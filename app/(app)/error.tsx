"use client"

import { RotateCcw } from "lucide-react"
import { useEffect } from "react"

/** Shown instead of a page that crashed. Server details stay in the logs (matched by `digest`). */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  const offline = typeof navigator !== "undefined" && !navigator.onLine
  return (
    <div className="mt-10 flex flex-col items-center gap-3 rounded-3xl border bg-card p-8 text-center shadow-sm">
      <p className="text-lg font-bold">{offline ? "You're offline" : "This page didn't load"}</p>
      <p className="text-sm text-muted-foreground">
        {offline
          ? "Check your internet connection, then try again. Your data is safe."
          : "Something went wrong on our side. Your data is safe. Try again, and if it keeps happening let us know."}
      </p>
      {error.digest && <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>}
      <button onClick={() => retry()} className="mt-2 flex h-11 items-center gap-2 rounded-2xl bg-brand px-5 font-bold text-ink">
        <RotateCcw className="size-4" /> Try again
      </button>
    </div>
  )
}
