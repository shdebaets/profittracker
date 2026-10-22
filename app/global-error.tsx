"use client"

import "./globals.css"

/** Last-resort screen when the root layout itself fails. Renders its own document. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
        <title>FlipLedger</title>
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <p className="text-lg font-bold">FlipLedger hit a snag</p>
          <p className="text-sm text-muted-foreground">
            Something went wrong while loading the app. Your data is safe. Try again in a moment.
          </p>
          {error.digest && <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>}
          <button onClick={() => retry()} className="mt-2 h-11 rounded-2xl bg-brand px-5 font-bold text-ink">
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
