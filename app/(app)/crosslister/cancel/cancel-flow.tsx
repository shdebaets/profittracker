"use client"

import { Car, MessageCircle, Package, PiggyBank, Receipt } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { NativeSelect } from "@/components/fields"
import { formatDate } from "@/lib/dates"
import { formatCents } from "@/lib/money"
import { cancelCrosslister } from "../actions"

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
  stats, renewsAt,
}: { stats: Stats; renewsAt: string | null }) {
  const router = useRouter()
  const [pending, start] = useTransition()
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
    { icon: Car, label: `Miles logged in ${stats.year}`, value: stats.miles.toLocaleString("en-US") },
    { icon: Receipt, label: `Expenses logged in ${stats.year}`, value: formatCents(stats.expenseCents) },
    { icon: Package, label: `Items bought in ${stats.year}`, value: stats.items.toLocaleString("en-US") },
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
        <p className="font-semibold">If you cancel, on {ends} these stop:</p>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          <li>Adding and editing: no new items, sales, lots, mileage or expenses.</li>
          <li>Cross-listing: no more listing to eBay or auto-filling Facebook, Poshmark and Mercari.</li>
          <li>
            Auto-delist: a sale on one site won&apos;t take the item down on the others
            {stats.liveListings > 0 ? ` (you have ${stats.liveListings} live listing${stats.liveListings === 1 ? "" : "s"})` : ""}.
          </li>
          <li>Smart Offers: no more automatic offers to interested buyers.</li>
          <li>AI listing: no more writing listings from your photos.</li>
        </ul>
        <p className="mt-3 font-semibold">You can still:</p>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          <li>View all your history: items, sales, lots, mileage, expenses and taxes.</li>
          <li>Export it: CSV, tax PDF and the print report.</li>
        </ul>
      </div>

      {step === "offers" ? (
        <>
          {/* Offers here used to quote prices; sales and save offers now go through account managers (row 30). */}
          <section className="flex flex-col gap-2 rounded-3xl border bg-card p-5">
            <p className="flex items-center gap-2 font-bold"><MessageCircle className="size-5 text-brand" /> Talk to us first</p>
            <p className="text-sm text-muted-foreground">
              If something isn&apos;t working for you, your account manager can help. Message them or your ticket before you go.
            </p>
          </section>

          <div className="flex flex-col gap-2">
            <Link href="/crosslister" className="flex h-12 items-center justify-center rounded-2xl bg-profit font-bold text-white">
              Keep my membership
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
            onClick={() => run(() => cancelCrosslister({ reason }), `Cancelled. Your membership stays active until ${ends}.`)}
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
