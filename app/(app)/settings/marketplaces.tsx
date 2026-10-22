"use client"

import { Link2, Loader2, RefreshCw } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { disconnectEbay, refreshEbayPolicies, saveEbaySettings, syncSales } from "@/app/(app)/actions/crosslist"
import { FieldLabel, NativeSelect, TextInput } from "@/components/fields"
import { relativeTime } from "@/lib/dates"
import { setupGaps } from "@/lib/marketplaces/ebay/mapping"
import { MARKETPLACES } from "@/lib/marketplaces/registry"
import type { EbayPolicy, MarketplaceConnection } from "@/lib/types"
import { cn } from "@/lib/utils"
import { GENERIC_ERROR } from "@/lib/errors"

const CONNECT_MESSAGES: Record<string, [ok: boolean, msg: string]> = {
  connected: [true, "eBay connected"],
  declined: [false, "eBay connection was cancelled"],
  state_mismatch: [false, "eBay sign-in expired. Try connecting again"],
  error: [false, "Couldn't connect eBay. Try again"],
  not_configured: [false, "eBay API keys aren't set up for this app yet"],
}

export function MarketplacesSettings({
  ebay, configured, sandbox, connectStatus,
}: {
  ebay: MarketplaceConnection | null
  configured: boolean
  sandbox: boolean
  connectStatus?: string
}) {
  const router = useRouter()
  useEffect(() => {
    const m = connectStatus && CONNECT_MESSAGES[connectStatus]
    if (!m) return
    if (m[0]) toast.success(m[1])
    else toast.error(m[1])
    router.replace("/settings#marketplaces", { scroll: false })
  }, [connectStatus, router])

  return (
    <section id="marketplaces" className="flex scroll-mt-4 flex-col gap-4 rounded-3xl border bg-card p-5 shadow-sm">
      <div>
        <p className="font-semibold">Marketplaces</p>
        <p className="text-sm text-muted-foreground">
          Cross-list from any item. When it sells on one marketplace, FlipLedger takes it down on the others.
        </p>
      </div>

      <div className="rounded-2xl border p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-7 min-w-14 place-items-center rounded-lg bg-blue-600 px-2 text-xs font-bold text-white">eBay</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">
              {ebay ? (ebay.external_username ?? "Connected") : "Not connected"}
              {sandbox && <span className="ml-2 rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-bold text-brand uppercase">Sandbox</span>}
            </p>
            <p className="text-xs text-muted-foreground">
              {ebay
                ? ebay.last_synced_at
                  ? `Sales synced ${relativeTime(ebay.last_synced_at)}`
                  : "Sales not synced yet"
                : "Lists and ends listings automatically, and imports sales"}
            </p>
          </div>
        </div>
        {!ebay && (
          <a
            href={configured ? "/api/marketplaces/ebay/connect" : undefined}
            aria-disabled={!configured}
            onClick={(e) => {
              if (!configured) {
                e.preventDefault()
                toast.error(CONNECT_MESSAGES.not_configured[1])
              }
            }}
            className={cn("mt-3 flex h-11 items-center justify-center gap-1.5 rounded-xl bg-blue-600 font-bold text-white", !configured && "opacity-50")}
          >
            <Link2 className="size-4" /> Connect eBay
          </a>
        )}
        {ebay && <EbaySetup ebay={ebay} />}
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold">Tracked with reminders</p>
        <div className="flex flex-wrap gap-1.5">
          {MARKETPLACES.filter((m) => m.mode === "assisted").map((m) => (
            <span key={m.id} className={cn("rounded-lg px-2 py-1 text-xs font-bold", m.badge)}>{m.label}</span>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          These have no public API. FlipLedger gives you a copy-and-paste listing kit, tracks where each item is listed, and tells you what to delist when it sells.
        </p>
      </div>
    </section>
  )
}

function PolicySelect({ label, list, value, onChange }: { label: string; list: EbayPolicy[]; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <FieldLabel className="mb-1 text-xs">{label}</FieldLabel>
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} className="h-11 text-sm">
        <option value="">{list.length ? "Choose…" : "None on eBay yet"}</option>
        {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </NativeSelect>
    </div>
  )
}

function EbaySetup({ ebay }: { ebay: MarketplaceConnection }) {
  const s = ebay.settings ?? {}
  const [f, setF] = useState(s.fulfillmentPolicyId ?? "")
  const [p, setP] = useState(s.paymentPolicyId ?? "")
  const [r, setR] = useState(s.returnPolicyId ?? "")
  const [zip, setZip] = useState(s.postalCode ?? "")
  const [pending, start] = useTransition()
  const gaps = setupGaps(s)
  const policies = s.policies ?? { fulfillment: [], payment: [], return: [] }

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      const res = await fn()
      if (res.ok) toast.success(msg)
      else toast.error(res.error ?? GENERIC_ERROR)
    })

  return (
    <div className="mt-4 flex flex-col gap-3 border-t pt-4">
      {s.setupError && <p className="rounded-xl bg-loss/10 px-3 py-2 text-sm text-loss">{s.setupError}</p>}
      {gaps.length > 0 ? (
        <p className="text-sm">To list on eBay, add {gaps.join(", ")}.</p>
      ) : (
        <p className="text-sm text-profit">Ready to list on eBay.</p>
      )}
      <PolicySelect label="Shipping policy" list={policies.fulfillment} value={f} onChange={setF} />
      <PolicySelect label="Payment policy" list={policies.payment} value={p} onChange={setP} />
      <PolicySelect label="Return policy" list={policies.return} value={r} onChange={setR} />
      <div>
        <FieldLabel className="mb-1 text-xs">Ship-from ZIP code</FieldLabel>
        <TextInput inputMode="numeric" value={zip} onChange={(e) => setZip(e.target.value)} placeholder="e.g. 30301" className="h-11" />
      </div>
      <p className="text-xs text-muted-foreground">
        Policies are managed on eBay (Account → Business policies). Made a new one? Tap refresh.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button
          disabled={pending}
          onClick={() =>
            run(
              () => saveEbaySettings({
                fulfillmentPolicyId: f || undefined,
                paymentPolicyId: p || undefined,
                returnPolicyId: r || undefined,
                postalCode: zip.trim() || undefined,
              }),
              "eBay settings saved",
            )
          }
          className="col-span-2 flex h-11 items-center justify-center gap-2 rounded-xl bg-brand font-bold text-ink disabled:opacity-60"
        >
          {pending && <Loader2 className="size-4 animate-spin" />} Save eBay settings
        </button>
        <button
          disabled={pending}
          onClick={() => run(refreshEbayPolicies, "Policies refreshed")}
          className="flex h-11 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold"
        >
          <RefreshCw className="size-4" /> Refresh policies
        </button>
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await syncSales()
              if (res.ok) toast.success(res.data.sales ? `${res.data.sales} new sale${res.data.sales === 1 ? "" : "s"} synced` : "No new eBay sales")
              else toast.error(res.error)
            })
          }
          className="flex h-11 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold"
        >
          <RefreshCw className="size-4" /> Sync sales now
        </button>
        <button
          disabled={pending}
          onClick={() => {
            if (confirm("Disconnect eBay? Live eBay listings stay up but FlipLedger won't end them or sync their sales.")) {
              run(disconnectEbay, "eBay disconnected")
            }
          }}
          className="col-span-2 text-sm font-semibold text-destructive"
        >
          Disconnect eBay
        </button>
      </div>
    </div>
  )
}
