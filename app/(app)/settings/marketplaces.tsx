"use client"

import { ExternalLink, Link2, Loader2, RefreshCw, Sparkles } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { createEbayPolicies, disconnectEbay, refreshEbayPolicies, saveEbaySettings, syncSales } from "@/app/(app)/actions/crosslist"
import { checkExtensionSales } from "@/components/crosslist/auto-sync"
import { FieldLabel, MoneyInput, NativeSelect, Segmented, TextInput } from "@/components/fields"
import { relativeTime } from "@/lib/dates"
import { missingPolicies, setupGaps } from "@/lib/marketplaces/ebay/mapping"
import { toCents } from "@/lib/money"
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
  ebay, configured, sandbox, policiesUrl, connectStatus,
}: {
  ebay: MarketplaceConnection | null
  configured: boolean
  sandbox: boolean
  /** eBay's business policies page (sandbox or production). */
  policiesUrl: string
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
        {ebay && (
          // Remount when policies change so the dropdowns pick up ones we just created.
          <EbaySetup
            key={[ebay.settings?.fulfillmentPolicyId, ebay.settings?.paymentPolicyId, ebay.settings?.returnPolicyId].join()}
            ebay={ebay}
            policiesUrl={policiesUrl}
          />
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold">Filled in by the FlipLedger Chrome extension</p>
        <div className="flex flex-wrap gap-1.5">
          {MARKETPLACES.filter((m) => m.extension).map((m) => (
            <span key={m.id} className={cn("rounded-lg px-2 py-1 text-xs font-bold", m.badge)}>{m.label}</span>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          On a computer, the extension opens the site and fills in your photos and details; you check it and click Publish. While FlipLedger is open, it spots Poshmark and Mercari sales and puts the item on your delist list everywhere else. On your phone, use the copy kit.
        </p>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold">Copy kit</p>
        <div className="flex flex-wrap gap-1.5">
          {MARKETPLACES.filter((m) => m.mode === "assisted" && !m.extension).map((m) => (
            <span key={m.id} className={cn("rounded-lg px-2 py-1 text-xs font-bold", m.badge)}>{m.label}</span>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          FlipLedger gives you the photos and text to paste, tracks where each item is listed, and tells you what to delist when it sells.
        </p>
      </div>
    </section>
  )
}

function PolicySelect({ label, list, value, onChange }: { label: string; list: EbayPolicy[]; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <FieldLabel className="mb-1 text-xs">{label}</FieldLabel>
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{list.length ? "Choose…" : "None on eBay yet"}</option>
        {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </NativeSelect>
    </div>
  )
}

function EbaySetup({ ebay, policiesUrl }: { ebay: MarketplaceConnection; policiesUrl: string }) {
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
      {missingPolicies(s).length > 0 && <PolicyStarter settings={s} />}
      <PolicySelect label="Shipping policy" list={policies.fulfillment} value={f} onChange={setF} />
      <PolicySelect label="Payment policy" list={policies.payment} value={p} onChange={setP} />
      <PolicySelect label="Return policy" list={policies.return} value={r} onChange={setR} />
      <div>
        <FieldLabel className="mb-1 text-xs">Ship-from ZIP code</FieldLabel>
        <TextInput inputMode="numeric" value={zip} onChange={(e) => setZip(e.target.value)} placeholder="e.g. 30301" className="h-11" />
      </div>
      <p className="text-xs text-muted-foreground">
        Policies live on your eBay account, so you can edit them or add more anytime.{" "}
        <a href={policiesUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-blue-600">
          Manage on eBay <ExternalLink className="size-3" />
        </a>
        , then tap Refresh policies.
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
              await checkExtensionSales()
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

/** Creates simple shipping/payment/return policies on eBay for whatever the seller hasn't picked. */
function PolicyStarter({ settings }: { settings: MarketplaceConnection["settings"] }) {
  const missing = missingPolicies(settings)
  const [shipping, setShipping] = useState<"buyer" | "free">("buyer")
  const [cost, setCost] = useState("8.99")
  const [handling, setHandling] = useState<"1" | "2" | "3">("1")
  const [returns, setReturns] = useState<"30" | "none">("30")
  const [pending, start] = useTransition()

  const create = () =>
    start(async () => {
      const costCents = toCents(cost)
      if (shipping === "buyer" && !costCents) return void toast.error("Enter what buyers pay for shipping")
      const res = await createEbayPolicies({
        shipping: { free: shipping === "free", costCents, handlingDays: Number(handling) as 1 | 2 | 3 },
        returns: { accepted: returns === "30" },
      })
      if (res.ok) toast.success("Policies created on eBay")
      else toast.error(res.error ?? GENERIC_ERROR)
    })

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-blue-600/30 bg-blue-600/5 p-3">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="size-4 text-blue-600" /> Set up policies for me</p>
        <p className="text-xs text-muted-foreground">
          Don&apos;t have policies yet? Pick a few basics and FlipLedger creates them on your eBay account.
        </p>
      </div>
      {missing.includes("fulfillment") && (
        <>
          <div>
            <FieldLabel className="mb-1 text-xs">Shipping (USPS Ground Advantage)</FieldLabel>
            <Segmented
              value={shipping}
              onChange={setShipping}
              options={[{ value: "buyer", label: "Buyer pays" }, { value: "free", label: "Free shipping" }]}
            />
          </div>
          {shipping === "buyer" && (
            <div>
              <FieldLabel htmlFor="ship-cost" className="mb-1 text-xs">Shipping charge</FieldLabel>
              <MoneyInput id="ship-cost" value={cost} onChange={setCost} />
            </div>
          )}
          <div>
            <FieldLabel className="mb-1 text-xs">Ships within</FieldLabel>
            <Segmented
              value={handling}
              onChange={setHandling}
              options={[{ value: "1", label: "1 day" }, { value: "2", label: "2 days" }, { value: "3", label: "3 days" }]}
            />
          </div>
        </>
      )}
      {missing.includes("return") && (
        <div>
          <FieldLabel className="mb-1 text-xs">Returns</FieldLabel>
          <Segmented
            value={returns}
            onChange={setReturns}
            options={[{ value: "30", label: "30 days, buyer pays" }, { value: "none", label: "No returns" }]}
          />
        </div>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={create}
        className="flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 font-bold text-white disabled:opacity-60"
      >
        {pending && <Loader2 className="size-4 animate-spin" />} Create on eBay
      </button>
    </div>
  )
}
