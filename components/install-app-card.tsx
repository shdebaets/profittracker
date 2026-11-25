"use client"

import { EllipsisVertical, Share, SquarePlus, X } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import { Logo } from "@/components/logo"
import { DISMISS_KEY, installPlatform, isDismissed, type InstallPlatform } from "@/lib/install"
import { getInstallPrompt, isStandalone, onInstallChange, runInstallPrompt, wasJustInstalled } from "@/lib/install-prompt"

type Where = "home" | "settings"

function readDismiss() {
  try {
    return localStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
}
function writeDismiss(v: string) {
  try {
    localStorage.setItem(DISMISS_KEY, v)
  } catch {}
}

const Key = ({ children }: { children: ReactNode }) => (
  <b className="inline-flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 align-middle text-foreground">{children}</b>
)

/**
 * "Add FlipLedger to your Home Screen" (tracker row 65). Top of the dashboard (phones only,
 * "Not now" = 7 days, "I've added it" = for good) and top of Settings (always, until installed).
 * Hidden when FlipLedger is already open as the Home Screen app.
 */
export function InstallAppCard({ where }: { where: Where }) {
  const [state, setState] = useState<{ platform: InstallPlatform; canPrompt: boolean; host: string } | null>(null)
  const [hidden, setHidden] = useState(true)

  useEffect(() => {
    const refresh = () => {
      if (isStandalone() || wasJustInstalled()) return setHidden(true)
      const platform = installPlatform(navigator.userAgent, navigator.maxTouchPoints)
      setState({ platform, canPrompt: !!getInstallPrompt(), host: location.host })
      // The home card is for phones; computers can still find it in Settings.
      setHidden(where === "home" && (platform === "desktop" || isDismissed(readDismiss())))
    }
    refresh()
    return onInstallChange(refresh)
  }, [where])

  if (hidden || !state) return null
  const { platform, canPrompt, host } = state

  const dismiss = (v: string) => {
    writeDismiss(v)
    setHidden(true)
  }

  let steps: ReactNode
  if (platform === "ios-safari") {
    steps = (
      <ol className="flex list-decimal flex-col gap-1.5 pl-5">
        <li>
          Tap <Key><Share className="size-3.5" /> Share</Key> at the bottom of Safari (top right on iPad).
        </li>
        <li>
          Scroll down and tap <Key><SquarePlus className="size-3.5" /> Add to Home Screen</Key>, then <b>Add</b>.
        </li>
        <li>Open FlipLedger from the new icon on your Home Screen.</li>
      </ol>
    )
  } else if (platform === "ios-other") {
    steps = (
      <ol className="flex list-decimal flex-col gap-1.5 pl-5">
        <li>
          Tap <Key><Share className="size-3.5" /> Share</Key> next to the address bar.
        </li>
        <li>
          Tap <Key><SquarePlus className="size-3.5" /> Add to Home Screen</Key>.
        </li>
        <li>
          Don&apos;t see it? Open <b>{host}</b> in <b>Safari</b> and do it there.
        </li>
      </ol>
    )
  } else if (canPrompt) {
    steps = <p>One tap and FlipLedger gets its own icon on your {platform === "desktop" ? "computer" : "phone"}.</p>
  } else if (platform === "android") {
    steps = (
      <p>
        Tap the browser menu <Key><EllipsisVertical className="size-3.5" /></Key> (top right), then <b>Add to Home screen</b> or{" "}
        <b>Install app</b>.
      </p>
    )
  } else {
    steps = (
      <p>
        On your phone, open <b>{host}</b>. iPhone: tap <Key><Share className="size-3.5" /> Share</Key> →{" "}
        <b>Add to Home Screen</b>. Android: tap the menu <Key><EllipsisVertical className="size-3.5" /></Key> →{" "}
        <b>Install app</b>.
      </p>
    )
  }

  return (
    <section
      aria-label="Add FlipLedger to your Home Screen"
      className="relative rounded-3xl border border-brand/40 bg-brand-soft p-5 text-sm shadow-sm"
    >
      {where === "home" && (
        <button
          onClick={() => dismiss(String(Date.now()))}
          aria-label="Hide for a week"
          className="absolute top-3 right-3 rounded-full p-1.5 text-muted-foreground hover:bg-card"
        >
          <X className="size-4" />
        </button>
      )}
      <div className="flex items-center gap-3 pr-6">
        <Logo size={44} />
        <div className="min-w-0">
          <p className="font-heading text-base leading-tight font-bold">Add FlipLedger to your Home Screen</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Opens full screen like an app, one tap away.</p>
        </div>
      </div>
      <div className="mt-4 text-foreground/90">{steps}</div>
      {platform.startsWith("ios") && (
        <p className="mt-3 text-xs text-muted-foreground">
          iPhone only sends FlipLedger notifications (return deadlines, your Sunday recap) to the Home Screen app.
        </p>
      )}
      {(canPrompt || where === "home") && (
        <div className="mt-4 flex flex-wrap gap-2">
          {canPrompt && (
            <button
              onClick={async () => {
                if (await runInstallPrompt()) setHidden(true)
              }}
              className="h-11 flex-1 rounded-2xl bg-brand px-4 font-bold text-ink"
            >
              Install app
            </button>
          )}
          {where === "home" && (
            <>
              <button onClick={() => dismiss(String(Date.now()))} className="h-11 rounded-2xl border bg-card px-4 font-semibold">
                Not now
              </button>
              {!canPrompt && (
                <button onClick={() => dismiss("never")} className="h-11 flex-1 rounded-2xl bg-brand px-4 font-bold text-ink">
                  I&apos;ve added it
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
