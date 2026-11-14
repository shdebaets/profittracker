"use client"

import { Car, CirclePause, Package, PiggyBank, Receipt, Share2, Tag } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { NativeSelect } from "@/components/fields"
import { formatDate } from "@/lib/dates"
import { formatCents } from "@/lib/money"
import { acceptSaveOffer, cancelCrosslister, pauseCrosslister } from "../actions"

type Stats = { savings: number; year: number; miles: number; expenseCents: number; items: number; liveListings: number }

const REASONS = [
  "Too expensive",
  "Not selling much right now",
  "Taking a break from reselling",
  "Missing a feature I need",
  "Something isn't working",
  "Switching to another tool",
  "Other",
]

export function CancelFlow({
  stats, plan, renewsAt, annualUrl, hasPromo,
}: { stats: Stats; plan: string; renewsAt: string | null; annualUrl: string; hasPromo: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [months, setMonths] = useState("1")
  const [step, setStep] = useState<"offers" | "confirm">("offers")
  const [reason, setReason] = useState("")
  const ends = renewsAt ? formatDate(renewsAt) : "the end of this billing period"

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const res = await fn()
      if (!res.ok) return void toast.error(res.error ?? "Something went wrong")
      toast.success(ok)
      router.push("/crosslister")
      router.refresh()
    })

  const tiles = [
    { icon: PiggyBank, label: `Taxes saved in ${stats.year}`, value: formatCents(stats.savings), tone: "text-profit" },
    { icon: Car, label: "Miles logged", value: stats.miles.toLocaleString("en-US") },
    { icon: Receipt, label: "Expenses logged", value: formatCents(stats.expenseCents) },
    { icon: Package, label: "Items tracked", value: stats.items.toLocaleString("en-US") },
  ]

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-3xl border bg-card p-4">
            <t.icon className="size-5 text-muted-foreground" />
            <p className={`mt-2 font-mono text-xl font-bold ${t.tone ?? ""}`}>{t.value}</p>
            <p className="text-xs text-muted-foreground">{t.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-3xl border border-brand/40 bg-brand-soft p-5 text-sm">
        <p className="font-semibold">If you cancel, on {ends}:</p>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          <li>Cross-listing turns off. No more listing to eBay or auto-filling other sites.</li>
          <li>
            Sales stop syncing and nothing gets delisted for you
            {stats.liveListings > 0 ? `. You have ${stats.liveListings} live listing${stats.liveListings === 1 ? "" : "s"}, so a sale on one site won't take it down on the others` : ""}.
          </li>
          <li>Your history stays. You can still view and export your sales, mileage and taxes.</li>
        </ul>
      </div>

      {step === "offers" ? (
        <>
          <section className="flex flex-col gap-3 rounded-3xl border bg-card p-5">
            <p className="flex items-center gap-2 font-bold"><CirclePause className="size-5 text-brand" /> Take a break instead</p>
            <p className="text-sm text-muted-foreground">
              Pause billing for up to 3 months. You keep everything, and billing starts again on its own.
            </p>
            <div className="flex gap-2">
              <NativeSelect value={months} onChange={(e) => setMonths(e.target.value)} className="w-36">
                <option value="1">1 month</option>
                <option value="2">2 months</option>
                <option value="3">3 months</option>
              </NativeSelect>
              <button
                disabled={pending}
                onClick={() => run(() => pauseCrosslister(Number(months)), `Paused for ${months} month${months === "1" ? "" : "s"}`)}
                className="h-12 flex-1 rounded-2xl bg-brand font-bold text-ink disabled:opacity-60"
              >
                Pause billing
              </button>
            </div>
          </section>

          {hasPromo && (
            <section className="flex flex-col gap-3 rounded-3xl border bg-card p-5">
              <p className="flex items-center gap-2 font-bold"><Tag className="size-5 text-brand" /> Stay for less</p>
              <p className="text-sm text-muted-foreground">Keep the Cross-Lister at a lower price on your next renewals.</p>
              <button
                disabled={pending}
                onClick={() => run(acceptSaveOffer, "Discount applied to your next renewal")}
                className="h-12 rounded-2xl bg-brand font-bold text-ink disabled:opacity-60"
              >
                Claim the discount
              </button>
            </section>
          )}

          {annualUrl && plan === "monthly" && (
            <section className="flex flex-col gap-3 rounded-3xl border bg-card p-5">
              <p className="flex items-center gap-2 font-bold"><Share2 className="size-5 text-brand" /> Go yearly and save $60</p>
              <p className="text-sm text-muted-foreground">
                $300 a year instead of $360. Your monthly plan stops renewing automatically once you switch.
              </p>
              <a href={annualUrl} className="flex h-12 items-center justify-center rounded-2xl bg-ink font-bold text-white">
                Switch to yearly
              </a>
            </section>
          )}

          <div className="flex flex-col gap-2">
            <Link href="/crosslister" className="flex h-12 items-center justify-center rounded-2xl bg-profit font-bold text-white">
              Keep my Cross-Lister
            </Link>
            <button onClick={() => setStep("confirm")} className="h-12 rounded-2xl text-sm font-semibold text-muted-foreground">
              No thanks, cancel
            </button>
          </div>
        </>
      ) : (
        <section className="flex flex-col gap-3 rounded-3xl border bg-card p-5">
          <p className="font-bold">Why are you cancelling?</p>
          <NativeSelect value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Pick one</option>
            {REASONS.map((r) => <option key={r}>{r}</option>)}
          </NativeSelect>
          <button
            disabled={pending || !reason}
            onClick={() => run(() => cancelCrosslister({ reason }), `Cancelled. You keep the Cross-Lister until ${ends}.`)}
            className="h-12 rounded-2xl border border-destructive font-bold text-destructive disabled:opacity-50"
          >
            Cancel at the end of my period
          </button>
          <button onClick={() => setStep("offers")} className="h-11 text-sm font-semibold text-muted-foreground">
            Go back
          </button>
        </section>
      )}
    </>
  )
}
