"use client"

import { HandCoins } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { saveOfferRules } from "@/app/(app)/actions/offers"
import { FieldLabel, Toggle } from "@/components/fields"
import { relativeTime } from "@/lib/dates"
import { formatCents } from "@/lib/money"

export type OfferRuleRow = {
  enabled: boolean
  discount_pct: number
  max_discount_pct: number
  floor_margin_pct: number
  min_age_days: number
  every_days: number
}
export type OfferLog = { id: string; title: string | null; list_price_cents: number; offer_cents: number; sent_at: string; outcome: string | null; error: string | null }

const DEFAULTS: OfferRuleRow = { enabled: false, discount_pct: 10, max_discount_pct: 20, floor_margin_pct: 20, min_age_days: 7, every_days: 3 }

function Num({ id, label, value, onChange, suffix }: { id: string; label: string; value: number; onChange: (n: number) => void; suffix: string }) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <label className="flex h-12 items-center gap-1 rounded-2xl border bg-muted/60 px-3">
        <input
          id={id} inputMode="numeric" value={String(value)}
          onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "").slice(0, 3)) || 0)}
          className="w-full bg-transparent font-mono font-semibold outline-none"
        />
        <span className="text-sm text-muted-foreground">{suffix}</span>
      </label>
    </div>
  )
}

export function SmartOffers({ rule, log }: { rule: OfferRuleRow | null; log: OfferLog[] }) {
  const [r, setR] = useState<OfferRuleRow>(rule ?? DEFAULTS)
  const [pending, start] = useTransition()
  const set = <K extends keyof OfferRuleRow>(k: K, v: OfferRuleRow[K]) => setR((x) => ({ ...x, [k]: v }))
  const sold = log.filter((o) => o.outcome === "sold")
  const soldValue = sold.reduce((a, o) => a + o.offer_cents, 0)

  return (
    <section className="flex flex-col gap-4 rounded-3xl border bg-card p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-brand-soft"><HandCoins className="size-5 text-brand" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">Smart Offers on eBay</p>
          <p className="text-sm text-muted-foreground">Sends offers to people watching your eBay listings, by your rules. Never below cost plus your margin.</p>
        </div>
        <Toggle checked={r.enabled} onChange={(v) => set("enabled", v)} label="Smart Offers" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Num id="so-disc" label="Start at" value={r.discount_pct} onChange={(n) => set("discount_pct", n)} suffix="% off" />
        <Num id="so-max" label="Go up to" value={r.max_discount_pct} onChange={(n) => set("max_discount_pct", n)} suffix="% off" />
        <Num id="so-floor" label="Floor: cost +" value={r.floor_margin_pct} onChange={(n) => set("floor_margin_pct", n)} suffix="%" />
        <Num id="so-age" label="Only after" value={r.min_age_days} onChange={(n) => set("min_age_days", n)} suffix="days" />
        <Num id="so-every" label="Send every" value={r.every_days} onChange={(n) => set("every_days", n)} suffix="days" />
      </div>
      <p className="text-xs text-muted-foreground">
        The discount grows 1% a week past the starting age, up to your max. Offers last 2 days. eBay only: Poshmark and Mercari ban automated offers.
      </p>
      <button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await saveOfferRules({
              enabled: r.enabled, discountPct: r.discount_pct, maxDiscountPct: r.max_discount_pct,
              floorMarginPct: r.floor_margin_pct, minAgeDays: r.min_age_days, everyDays: r.every_days,
            })
            if (res.ok) toast.success(r.enabled ? "Smart Offers on" : "Saved")
            else toast.error(res.error)
          })
        }
        className="h-12 rounded-2xl bg-ink font-bold text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save Smart Offers"}
      </button>

      {log.length > 0 && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <p className="text-sm">
            <b>{log.filter((o) => !o.error).length}</b> offers sent · <b>{sold.length}</b> sold ({formatCents(soldValue)})
          </p>
          {log.slice(0, 8).map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate">{o.title ?? "Listing"}</span>
              <span className="shrink-0 font-mono text-muted-foreground">
                {formatCents(o.list_price_cents)} → {formatCents(o.offer_cents)} · {o.error ? "failed" : o.outcome ?? "sent"} · {relativeTime(o.sent_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
