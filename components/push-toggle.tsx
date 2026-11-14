"use client"

import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { pushPublicKey, removePushSubscription, savePushSubscription, sendTestPush } from "@/app/(app)/actions/push"
import { Toggle } from "@/components/fields"

type State = "loading" | "unsupported" | "ios-install" | "blocked" | "off" | "on"

const fromB64url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/" })
}

/** Settings → "Notifications on this device": the Sunday recap and a note after each sourcing trip. */
export function PushToggle() {
  const [state, setState] = useState<State>("loading")
  const [busy, start] = useTransition()

  useEffect(() => {
    const check = async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        // iPhone only allows push for apps added to the Home Screen.
        const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
        return setState(ios ? "ios-install" : "unsupported")
      }
      if (Notification.permission === "denied") return setState("blocked")
      const reg = await navigator.serviceWorker.getRegistration("/")
      const sub = await reg?.pushManager.getSubscription()
      if (sub) await savePushSubscription(sub.toJSON()) // keep the server copy fresh
      setState(sub ? "on" : "off")
    }
    check().catch(() => setState("unsupported"))
  }, [])

  const turnOn = () =>
    start(async () => {
      const key = await pushPublicKey()
      if (!key) return void toast.error("Notifications aren't set up on the server yet.")
      const permission = await Notification.requestPermission()
      if (permission !== "granted") return setState(permission === "denied" ? "blocked" : "off")
      const reg = await registration()
      await navigator.serviceWorker.ready
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(key) }))
      const res = await savePushSubscription(sub.toJSON())
      if (!res.ok) return void toast.error(res.error)
      setState("on")
      const test = await sendTestPush()
      if (!test.ok) toast.error(test.error)
    })

  const turnOff = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.getRegistration("/")
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await removePushSubscription(sub.endpoint)
        await sub.unsubscribe()
      }
      setState("off")
    })

  const note: Partial<Record<State, string>> = {
    unsupported: "This browser can't show notifications.",
    "ios-install": "On iPhone, add FlipLedger to your Home Screen first (Share → Add to Home Screen), then open it from there.",
    blocked: "Notifications are blocked for this site. Allow them in your browser settings, then come back.",
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Notifications on this device</span>
        <Toggle
          checked={state === "on"}
          onChange={(v) => (busy || state === "loading" || note[state] ? undefined : v ? turnOn() : turnOff())}
          label="Notifications on this device"
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {note[state] ?? "Your Sunday recap and a note after every sourcing trip."}
      </p>
    </div>
  )
}
