"use client"

import {
  ArrowRight, Car, DollarSign, Layers, Package, Pause, Pencil, Play, Plus, Receipt, Repeat, Search,
  Share2, ShieldCheck, Square, Trash2,
} from "lucide-react"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { createSubscription, deleteExpense, deleteSubscription, logMileage, setSubscriptionActive } from "@/app/(app)/actions/expenses"
import { BottomSheet } from "@/components/bottom-sheet"
import { FieldLabel, MoneyInput, NativeSelect, TextInput } from "@/components/fields"
import { StatCard } from "@/components/stat-card"
import { dollars, exportCsv } from "@/lib/csv"
import { dateInputToIso, formatDate, formatDateAt, toDateInput } from "@/lib/dates"
import { endTrip, gpsSupported, resumeTrip, startTrip, tripMiles, useGpsTrip } from "@/lib/gps-trip"
import { formatCents, toCents } from "@/lib/money"
import { expenseTotals } from "@/lib/overhead"
import { mileageDeduction } from "@/lib/profit"
import { DRIVE_PURPOSES, EXPENSE_CATEGORIES, type Expense, type Subscription } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ExpenseForm } from "./expense-form"
import { GENERIC_ERROR } from "@/lib/errors"

type Tab = "ledger" | "mileage" | "subs"

export function ExpensesView({ expenses, subs, rateCents }: { expenses: Expense[]; subs: Subscription[]; rateCents: number }) {
  const [tab, setTab] = useState<Tab>("ledger")
  const [sheet, setSheet] = useState<{ open: boolean; expense: Expense | null; key: number }>({ open: false, expense: null, key: 0 })
  const openSheet = (expense: Expense | null) => setSheet((s) => ({ open: true, expense, key: s.key + 1 }))

  const year = new Date().getFullYear()
  const ytd = expenseTotals(expenses.filter((e) => new Date(e.spent_at).getFullYear() === year), "all")
  const all = expenseTotals(expenses, "all")
  const activeSubs = subs.filter((s) => s.active)
  const subMonthly = activeSubs.reduce((a, s) => a + s.amount_cents, 0)
  const trips = expenses.filter((e) => e.kind === "mileage")
  const { trip: activeTrip } = useGpsTrip()

  // Re-attach GPS to a trip restored from storage (e.g. after a reload).
  useEffect(() => {
    resumeTrip()
  }, [])

  function onExport() {
    exportCsv(
      `flipledger-expenses-${toDateInput(new Date())}.csv`,
      expenses.map((e) => ({
        date: e.spent_at,
        type: e.kind,
        description: e.title,
        category: e.category,
        amount: dollars(e.amount_cents),
        miles: e.miles ?? "",
        rate_per_mile: e.rate_cents != null ? dollars(e.rate_cents) : "",
      })),
    )
  }

  const tabs = [
    { value: "ledger", icon: Layers, short: "Ledger", long: "Ledger", count: expenses.length, pill: "bg-muted text-muted-foreground" },
    { value: "mileage", icon: Car, short: "Mileage", long: "Mileage & GPS", count: trips.length, pill: "bg-profit-soft text-profit" },
    { value: "subs", icon: Repeat, short: "Subs", long: "Subscriptions", count: subs.length, pill: "bg-brand-soft text-brand" },
  ] as const

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="text-[1.6rem] leading-tight font-extrabold tracking-tight whitespace-nowrap">Business Overhead</h1>
            <span className="rounded-full border bg-card px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-muted-foreground">
              Schedule C
            </span>
          </div>
          <p className="text-muted-foreground">Operating supplies, subscriptions & write-offs</p>
        </div>
        <button
          onClick={onExport} aria-label="Export expenses CSV"
          className="grid size-11 shrink-0 place-items-center rounded-2xl border bg-card shadow-sm active:scale-95"
        >
          <Share2 className="size-5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setTab("mileage")}
          className="flex h-13 items-center justify-center gap-2 rounded-2xl bg-ink font-bold text-white shadow-sm active:scale-[0.98]"
        >
          <Car className="size-5 text-brand" /> Log Miles
        </button>
        <button
          onClick={() => openSheet(null)}
          className="flex h-13 items-center justify-center gap-2 rounded-2xl bg-brand font-bold text-ink shadow-sm shadow-brand/30 active:scale-[0.98]"
        >
          <Plus className="size-5" /> Add Expense
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatCard
          className="p-3" label="Total overhead"
          value={<span className="text-lg">{formatCents(all.total)}</span>}
          sub={<span className="text-xs">{expenses.length} entries recorded</span>}
        />
        <StatCard
          className="p-3" tone="brand" label="Subscriptions"
          value={<span className="text-lg">{formatCents(subMonthly)}<span className="text-xs font-normal text-muted-foreground">/mo</span></span>}
          sub={<span className="text-xs">{activeSubs.length} active ({subs.length - activeSubs.length} paused)</span>}
        />
        <StatCard
          className="p-3" tone="profit" label={`${year} mileage`}
          value={<span className="text-lg text-profit">{formatCents(ytd.mileageCents)}</span>}
          sub={<span className="text-xs">{ytd.miles.toFixed(1)} mi @ {formatCents(rateCents)}/mi</span>}
        />
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-muted p-1">
        {tabs.map((t) => (
          <button
            key={t.value} onClick={() => setTab(t.value)}
            className={cn(
              "flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-1 py-2 text-sm font-semibold transition",
              tab === t.value ? "bg-card shadow-sm" : "text-muted-foreground",
            )}
          >
            <t.icon className={cn("hidden size-4 shrink-0 min-[400px]:block", t.value === "mileage" && "text-profit", t.value === "subs" && "text-brand")} />
            <span className="truncate min-[400px]:hidden">{t.short}</span>
            <span className="hidden truncate min-[400px]:inline">{t.long}</span>
            <span className={cn("rounded-full px-1.5 font-mono text-xs", t.pill)}>{t.count}</span>
          </button>
        ))}
      </div>

      {activeTrip && tab !== "mileage" && (
        <button
          onClick={() => setTab("mileage")}
          className="flex items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-left text-white shadow-md"
        >
          <span className="relative flex size-2.5 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-profit opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-profit" />
          </span>
          <span className="flex-1 text-sm font-semibold">
            Trip in progress · <span className="font-mono">{tripMiles(activeTrip).toFixed(1)} mi</span>
          </span>
          <span className="flex items-center gap-1 text-sm font-bold text-brand">View <ArrowRight className="size-4" /></span>
        </button>
      )}

      {tab === "ledger" && <Ledger expenses={expenses} onEdit={openSheet} />}
      {tab === "mileage" && <Mileage trips={trips} rateCents={rateCents} />}
      {tab === "subs" && <Subscriptions subs={subs} />}

      <BottomSheet
        open={sheet.open}
        onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))}
        title={sheet.expense ? "Edit Expense" : "Add Expense"}
        description="Deductible business costs for Schedule C"
        icon={<Receipt className="size-5 text-brand" />}
        iconClass="bg-brand-soft"
      >
        <ExpenseForm key={sheet.key} expense={sheet.expense} onDone={() => setSheet((s) => ({ ...s, open: false }))} />
      </BottomSheet>
    </>
  )
}

function useRun() {
  const [pending, startTransition] = useTransition()
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, msg?: string, after?: () => void) =>
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) return void toast.error(res.error ?? GENERIC_ERROR)
      if (msg) toast.success(msg)
      after?.()
    })
  return { pending, run }
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      aria-label={label} disabled={disabled} onClick={onClick}
      className="grid size-8 place-items-center rounded-lg text-muted-foreground transition active:bg-muted disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-3xl border border-dashed bg-card/50 p-8 text-center text-muted-foreground">{children}</div>
}

function Ledger({ expenses, onEdit }: { expenses: Expense[]; onEdit: (e: Expense) => void }) {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("all")
  const { pending, run } = useRun()
  const q = query.trim().toLowerCase()
  const categories = [...new Set([...EXPENSE_CATEGORIES, ...expenses.map((e) => e.category)])]
  const visible = expenses.filter(
    (e) => (category === "all" || e.category === category) && (!q || e.title.toLowerCase().includes(q) || e.category.toLowerCase().includes(q)),
  )

  return (
    <>
      <label className="flex h-12 items-center gap-3 rounded-2xl border bg-card px-4">
        <Search className="size-5 shrink-0 text-muted-foreground" />
        <input
          value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search overhead records…"
          className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground/70"
        />
      </label>
      <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)} className="w-1/2 min-w-44">
        <option value="all">All Categories</option>
        {categories.map((c) => <option key={c}>{c}</option>)}
      </NativeSelect>

      <div className="flex flex-col gap-3">
        {visible.map((e) => {
          const isTrip = e.kind === "mileage"
          const packaging = e.category === "Packaging" || e.category === "Shipping Supplies"
          return (
            <div key={e.id} className="flex items-start gap-3 rounded-3xl border bg-card p-4 shadow-sm">
              <span className={cn("grid size-11 shrink-0 place-items-center rounded-2xl", isTrip ? "bg-profit-soft" : "bg-muted")}>
                {isTrip ? <Car className="size-5 text-profit" /> : packaging ? <Package className="size-5 text-blue-600" /> : <Layers className="size-5 text-muted-foreground" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 leading-snug font-semibold">{e.title}</p>
                <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                  {formatDateAt(e.spent_at)} · {e.category}
                </p>
                {isTrip && (
                  <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-profit-soft px-2 py-0.5 font-mono text-xs font-semibold text-profit">
                    IRS {formatCents(e.rate_cents ?? 0)}/mi · {Number(e.miles)} mi
                  </span>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <p className="font-mono text-lg font-bold tabular-nums">{formatCents(e.amount_cents)}</p>
                <div className="flex">
                  {!isTrip && (
                    <IconButton label="Edit" onClick={() => onEdit(e)}><Pencil className="size-4" /></IconButton>
                  )}
                  <IconButton
                    label="Delete" disabled={pending}
                    onClick={() => confirm(`Delete this ${isTrip ? "trip" : "expense"}?`) && run(() => deleteExpense(e.id), "Deleted")}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </div>
            </div>
          )
        })}
        {!visible.length && (
          <EmptyState>{expenses.length ? "No matching records." : "No expenses yet: boxes, tape, and mileage all count."}</EmptyState>
        )}
      </div>
    </>
  )
}

function useElapsed(startedAt: number | undefined) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!startedAt) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startedAt])
  if (!startedAt) return "0:00"
  const s = Math.max(0, Math.floor((now - startedAt) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
}

function Mileage({ trips, rateCents }: { trips: Expense[]; rateCents: number }) {
  const [purpose, setPurpose] = useState<string>(DRIVE_PURPOSES[0])
  const [manual, setManual] = useState(false)
  const [miles, setMiles] = useState("")
  const [date, setDate] = useState(toDateInput(new Date()))
  const { pending, run } = useRun()
  const { trip, error } = useGpsTrip()
  const elapsed = useElapsed(trip?.startedAt)
  const totals = expenseTotals(trips, "all")
  const milesNum = Number(miles) || 0
  const liveMiles = trip ? tripMiles(trip) : 0

  function start() {
    if (!gpsSupported()) {
      toast.error("GPS tracking needs the secure (https) version of the app. Use Manual Log for now.")
      return
    }
    startTrip()
    toast.success("Tracking started: keep FlipLedger open while you drive")
  }

  function stop() {
    const ended = endTrip()
    if (!ended) return
    const m = Math.round(tripMiles(ended) * 10) / 10
    if (m < 0.1) return void toast("Trip discarded: less than 0.1 mi recorded")
    run(
      () => logMileage({ purpose, miles: m, rateCents, spentAt: new Date(ended.startedAt).toISOString() }),
      `Trip saved: ${m} mi = ${formatCents(mileageDeduction(m, rateCents))}`,
    )
  }

  return (
    <>
      <div className="rounded-3xl border-2 border-brand/60 bg-gradient-to-br from-brand-soft via-card to-card p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand shadow-sm shadow-brand/30">
            <Car className="size-5 text-ink" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-lg leading-tight font-bold">Automatic Mileage Logging</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              GPS location tracking · <span className="font-semibold text-brand">Tax write-offs & expense reports</span>
            </p>
          </div>
        </div>
        <span className="mt-3 inline-block rounded-full bg-brand px-3 py-1 font-mono text-xs font-bold text-ink">
          {new Date().getFullYear()} IRS: <span className="underline">{formatCents(rateCents)}/mi</span>
        </span>

        <FieldLabel htmlFor="purpose" className="mt-4 text-xs tracking-widest uppercase">Select drive purpose:</FieldLabel>
        <NativeSelect id="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} disabled={!!trip}>
          {DRIVE_PURPOSES.map((p) => <option key={p}>{p}</option>)}
        </NativeSelect>

        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-brand/30 bg-card/90 px-4 py-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-profit-soft">
            <DollarSign className="size-4 text-profit" />
          </span>
          <p className="min-w-0 flex-1 text-sm leading-snug">
            Every <b>10 miles</b> driven = <b>{formatCents(rateCents * 10)}</b> deductible business expense
          </p>
          <span className="shrink-0 text-right text-xs leading-tight font-bold text-brand">Form 1040<br />Sch C</span>
        </div>

        {trip ? (
          <div className="mt-4 rounded-2xl bg-ink p-4 text-white">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-bold tracking-widest text-profit uppercase">
                <span className="relative flex size-2.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-profit opacity-75" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-profit" />
                </span>
                Tracking live
              </span>
              <span className="font-mono text-sm text-white/70 tabular-nums">{elapsed}</span>
            </div>
            <p className="mt-2 font-mono text-4xl font-extrabold tabular-nums">
              {liveMiles.toFixed(1)} <span className="text-lg font-semibold text-white/60">mi</span>
            </p>
            <p className="font-mono text-sm text-profit tabular-nums">
              {formatCents(mileageDeduction(Math.round(liveMiles * 10) / 10, rateCents))} deductible so far
            </p>
            {error && <p className="mt-2 rounded-lg bg-white/10 px-3 py-2 text-xs text-brand">{error}</p>}
            <button
              onClick={stop} disabled={pending}
              className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand font-bold text-ink active:scale-[0.98] disabled:opacity-60"
            >
              <Square className="size-4 fill-current" /> Stop & Save Trip
            </button>
          </div>
        ) : (
          <button
            onClick={start}
            className="mt-4 flex h-15 w-full items-center gap-2.5 rounded-2xl bg-gradient-to-r from-brand to-amber-400 px-3 text-base font-bold whitespace-nowrap text-ink shadow-md shadow-brand/30 active:scale-[0.99] min-[400px]:text-lg"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink">
              <Play className="ml-0.5 size-4 fill-white text-white" />
            </span>
            <span className="flex-1 text-left">Start Mileage Tracker</span>
            <span className="hidden rounded-lg bg-white/40 px-2 py-1 font-mono text-[11px] min-[400px]:inline">GPS Live</span>
          </button>
        )}

        {!trip && (
          <div className="mt-3">
            <button onClick={() => setManual((v) => !v)} className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1 text-sm">
              <span className="whitespace-nowrap text-muted-foreground">Forgot to turn on GPS?</span>
              <span className="flex items-center gap-1 font-semibold whitespace-nowrap text-brand">
                Manual Log Past Miles <ArrowRight className={cn("size-4 transition", manual && "rotate-90")} />
              </span>
            </button>
            {manual && (
              <div className="mt-3 flex flex-col gap-3 rounded-2xl border bg-card p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <FieldLabel htmlFor="miles">Miles driven</FieldLabel>
                    <label htmlFor="miles" className="flex h-12 items-center gap-2 rounded-2xl border bg-muted/60 px-3">
                      <input
                        id="miles" inputMode="decimal" placeholder="0.0" value={miles}
                        onChange={(e) => setMiles(e.target.value.replace(/[^0-9.]/g, ""))}
                        className="w-full min-w-0 bg-transparent font-mono font-semibold outline-none"
                      />
                      <span className="text-sm text-muted-foreground">mi</span>
                    </label>
                  </div>
                  <div className="min-w-0">
                    <FieldLabel htmlFor="trip-date">Date</FieldLabel>
                    <TextInput id="trip-date" type="date" className="px-3 text-[15px]" value={date} onChange={(e) => setDate(e.target.value)} />
                  </div>
                </div>
                <button
                  disabled={pending || milesNum <= 0}
                  onClick={() =>
                    run(
                      () => logMileage({ purpose, miles: milesNum, rateCents, spentAt: dateInputToIso(date) }),
                      "Trip logged",
                      () => setMiles(""),
                    )
                  }
                  className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-ink font-bold text-white disabled:opacity-40"
                >
                  <Plus className="size-4" />
                  {milesNum > 0 ? `Log ${milesNum} mi · ${formatCents(mileageDeduction(milesNum, rateCents))}` : "Log Trip"}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-brand/20 pt-3 text-sm">
          <span className="flex min-w-0 items-center gap-1.5">
            <ShieldCheck className="size-4 shrink-0 text-profit" />
            <span className="truncate">
              <b>{totals.trips}</b> trip{totals.trips === 1 ? "" : "s"} · <b>{totals.miles.toFixed(1)}</b> mi
            </span>
          </span>
          <span className="shrink-0 font-mono font-bold text-profit">{formatCents(totals.mileageCents)} deducted</span>
        </div>
      </div>

      {trips.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">Recent trips</p>
          {trips.map((e) => (
            <div key={e.id} className="flex items-center gap-3 rounded-3xl border bg-card p-4 shadow-sm">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-profit-soft"><Car className="size-5 text-profit" /></span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 leading-snug font-semibold">{e.title.replace(/^Mileage: /, "")}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {Number(e.miles)} mi · {formatDateAt(e.spent_at)}
                </p>
              </div>
              <p className="shrink-0 font-mono font-bold tabular-nums">{formatCents(e.amount_cents)}</p>
              <IconButton
                label="Delete" disabled={pending}
                onClick={() => confirm("Delete this trip?") && run(() => deleteExpense(e.id), "Deleted")}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function Subscriptions({ subs }: { subs: Subscription[] }) {
  const [name, setName] = useState("")
  const [amount, setAmount] = useState("")
  const { pending, run } = useRun()

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!toCents(amount)) return void toast.error("Enter the monthly amount")
          run(() => createSubscription({ name, amountCents: toCents(amount) }), "Subscription added", () => {
            setName("")
            setAmount("")
          })
        }}
        className="flex flex-col gap-3 rounded-3xl border bg-card p-4 shadow-sm"
      >
        <p className="flex items-center gap-2 font-bold">
          <Repeat className="size-4 text-brand" /> Add a monthly subscription
        </p>
        <TextInput required placeholder="e.g. Vendoo, eBay store, Canva" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex gap-2">
          <MoneyInput value={amount} onChange={setAmount} className="min-w-0 flex-1" />
          <button type="submit" disabled={pending} className="rounded-2xl bg-brand px-6 font-bold text-ink disabled:opacity-50">
            Add
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-3">
        {subs.map((s) => (
          <div key={s.id} className={cn("flex items-start gap-3 rounded-3xl border bg-card p-4 shadow-sm", !s.active && "opacity-60")}>
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-soft"><Repeat className="size-5 text-brand" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{s.name}</p>
              <p className="mt-0.5 flex items-baseline gap-1.5 text-sm leading-snug text-muted-foreground">
                <span className={cn("size-2 shrink-0 translate-y-[-1px] rounded-full", s.active ? "bg-profit" : "bg-muted-foreground/40")} />
                <span>{s.active ? "Active" : "Paused"} · since {formatDate(`${s.started_at}T12:00:00`)}</span>
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <p className="font-mono text-lg font-bold tabular-nums">
                {formatCents(s.amount_cents)}<span className="text-xs font-normal text-muted-foreground">/mo</span>
              </p>
              <div className="flex">
                <IconButton label={s.active ? "Pause" : "Resume"} disabled={pending} onClick={() => run(() => setSubscriptionActive(s.id, !s.active), s.active ? "Paused" : "Resumed")}>
                  {s.active ? <Pause className="size-4" /> : <Play className="size-4" />}
                </IconButton>
                <IconButton
                  label="Delete" disabled={pending}
                  onClick={() => confirm("Delete this subscription?") && run(() => deleteSubscription(s.id), "Deleted")}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            </div>
          </div>
        ))}
        {!subs.length && <EmptyState>Track recurring tools like crosslisters, store plans and shipping software.</EmptyState>}
      </div>
    </>
  )
}
