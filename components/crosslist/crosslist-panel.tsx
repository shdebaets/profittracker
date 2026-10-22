"use client"

import {
  ArrowLeft, Check, ChevronDown, Copy, ExternalLink, Images, Loader2, Search, Unplug,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import {
  delistEverywhere, ebayAspects, ebayCategories, endListing, forgetListing, getEbayStatus,
  markAssistedListed, publishEbay, saveListingDetails, type EbayStatus,
} from "@/app/(app)/actions/crosslist"
import { readSheetStore, writeSheetStore } from "@/components/entry/sheet-storage"
import { FieldLabel, MoneyInput, NativeSelect, TextInput } from "@/components/fields"
import type { Aspect, CategorySuggestion } from "@/lib/marketplaces/ebay/adapter"
import { ITEM_CONDITIONS, MARKETPLACES, type ItemCondition, type Marketplace } from "@/lib/marketplaces/registry"
import { centsToInput, formatCents, toCents } from "@/lib/money"
import type { Item, Listing } from "@/lib/types"
import { cn } from "@/lib/utils"

type Draft = {
  title: string
  description: string
  condition: ItemCondition | ""
  brand: string
  size: string
  price: string
}

const draftFrom = (i: Item): Draft => ({
  title: i.title ?? "",
  description: i.description ?? "",
  condition: i.condition ?? "",
  brand: i.brand ?? "",
  size: i.size ?? "",
  price: centsToInput(i.list_price_cents),
})

/** The full text a seller pastes into a marketplace's description box. */
export function listingText(d: Draft) {
  const facts = [
    d.condition && `Condition: ${ITEM_CONDITIONS.find((c) => c.value === d.condition)?.label}`,
    d.brand && `Brand: ${d.brand}`,
    d.size && `Size: ${d.size}`,
  ].filter(Boolean)
  return [d.description.trim(), facts.join("\n")].filter(Boolean).join("\n\n")
}

async function copy(text: string, what: string) {
  if (!text) return void toast.error(`No ${what} to copy yet`)
  const ok = await navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text))
  if (ok) toast.success(`${what[0].toUpperCase()}${what.slice(1)} copied`)
  else toast.error("Couldn't copy. Long-press the field instead")
}

/** Fallback for browsers/webviews that block the async Clipboard API. */
function legacyCopy(text: string) {
  const ta = document.createElement("textarea")
  ta.value = text
  ta.setAttribute("readonly", "")
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0"
  // Inside the open sheet, so the dialog's focus trap doesn't block selecting it.
  ;(document.activeElement?.closest("[role=dialog]") ?? document.body).appendChild(ta)
  ta.select()
  ta.setSelectionRange(0, text.length)
  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    ta.remove()
  }
}

export function CrosslistPanel({ item, active, onBack }: { item: Item; active: boolean; onBack: () => void }) {
  // Unsaved edits are kept per tab so a minimised sheet comes back intact after a reload.
  const [draft, setDraft] = useState<Draft>(() => {
    const kept = readSheetStore<{ itemId: string; draft: Draft }>("crosslist-draft")
    return kept?.itemId === item.id ? kept.draft : draftFrom(item)
  })
  const [ebay, setEbay] = useState<EbayStatus | null>(null)
  const [pending, startTransition] = useTransition()
  const saved = draftFrom(item)
  const dirty = (Object.keys(draft) as (keyof Draft)[]).some((k) =>
    k === "price" ? toCents(draft.price) !== toCents(saved.price) : draft[k].trim() !== saved[k],
  )
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  useEffect(() => {
    writeSheetStore("crosslist-draft", dirty ? { itemId: item.id, draft } : null)
  }, [dirty, draft, item.id])

  // Re-check when the sheet is resumed: the user may have just fixed eBay setup in Settings.
  useEffect(() => {
    if (active) getEbayStatus().then(setEbay, () => setEbay(null))
  }, [active])

  async function saveDraft(): Promise<boolean> {
    if (!dirty) return true
    const res = await saveListingDetails(item.id, {
      title: draft.title,
      description: draft.description,
      condition: draft.condition || null,
      brand: draft.brand,
      size: draft.size,
      listPriceCents: draft.price ? toCents(draft.price) : null,
    })
    if (!res.ok) toast.error(res.error)
    return res.ok
  }

  const listingFor = (m: Marketplace) => item.listings.find((l) => l.marketplace === m.id)
  const anyLive = item.listings.some((l) => l.status === "active")

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-3xl border bg-card p-4">
        <p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Listing details</p>
        <div>
          <FieldLabel htmlFor="xl-title">Title</FieldLabel>
          <TextInput id="xl-title" value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="Brand, item, size, color" />
          {draft.title.length > 80 && <p className="mt-1 text-xs text-muted-foreground">eBay shows the first 80 characters.</p>}
        </div>
        <div>
          <FieldLabel htmlFor="xl-desc">Description</FieldLabel>
          <textarea
            id="xl-desc" rows={4} value={draft.description} onChange={(e) => set("description", e.target.value)}
            placeholder="Measurements, flaws, details buyers ask about"
            className="w-full rounded-2xl border bg-muted/60 px-4 py-3 text-base outline-none focus:border-brand focus:bg-card focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <FieldLabel htmlFor="xl-cond">Condition</FieldLabel>
            <NativeSelect id="xl-cond" value={draft.condition} onChange={(e) => set("condition", e.target.value as ItemCondition | "")}>
              <option value="">Choose…</option>
              {ITEM_CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </NativeSelect>
          </div>
          <div>
            <FieldLabel htmlFor="xl-price">List price</FieldLabel>
            <MoneyInput id="xl-price" value={draft.price} onChange={(v) => set("price", v)} />
          </div>
          <div>
            <FieldLabel htmlFor="xl-brand">Brand</FieldLabel>
            <TextInput id="xl-brand" value={draft.brand} onChange={(e) => set("brand", e.target.value)} />
          </div>
          <div>
            <FieldLabel htmlFor="xl-size">Size</FieldLabel>
            <TextInput id="xl-size" value={draft.size} onChange={(e) => set("size", e.target.value)} />
          </div>
        </div>
        {dirty && (
          <button
            disabled={pending}
            onClick={() => startTransition(async () => void ((await saveDraft()) && toast.success("Details saved")))}
            className="h-11 rounded-2xl bg-ink font-bold text-white disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save details"}
          </button>
        )}
      </section>

      <p className="-mb-2 text-xs font-bold tracking-wider text-muted-foreground uppercase">Marketplaces</p>
      <EbayRow item={item} listing={listingFor(MARKETPLACES[0])} status={ebay} draft={draft} saveDraft={saveDraft} />
      {MARKETPLACES.filter((m) => m.mode === "assisted").map((m) => (
        <AssistedRow key={m.id} item={item} m={m} listing={listingFor(m)} draft={draft} saveDraft={saveDraft} />
      ))}

      {anyLive && (
        <button
          disabled={pending}
          onClick={() => {
            if (!confirm("Take this item down everywhere? eBay ends automatically; the others go on your to-do list.")) return
            startTransition(async () => {
              const res = await delistEverywhere(item.id)
              if (res.ok) toast.success("Delisting everywhere")
              else toast.error(res.error)
            })
          }}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl border bg-card font-semibold text-destructive"
        >
          <Unplug className="size-4" /> Delist everywhere
        </button>
      )}
      <button onClick={onBack} className="flex items-center justify-center gap-1.5 text-sm font-semibold text-muted-foreground">
        <ArrowLeft className="size-4" /> Back to item
      </button>
    </div>
  )
}

function RowShell({
  m, status, children, open, onToggle,
}: {
  m: Marketplace
  status: React.ReactNode
  children?: React.ReactNode
  open?: boolean
  onToggle?: () => void
}) {
  return (
    <div className="rounded-2xl border bg-card">
      <button
        type="button" onClick={onToggle} disabled={!onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className={cn("grid h-7 min-w-14 place-items-center rounded-lg px-2 text-xs font-bold", m.badge)}>{m.short}</span>
        <span className="min-w-0 flex-1 truncate font-semibold">{m.label}</span>
        {status}
        {onToggle && <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition", open && "rotate-180")} />}
      </button>
      {open && children && <div className="flex flex-col gap-3 border-t px-4 py-3">{children}</div>}
    </div>
  )
}

function Chip({ tone, children }: { tone: "live" | "warn" | "muted"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2.5 py-1 text-xs font-bold",
        tone === "live" && "bg-profit-soft text-profit",
        tone === "warn" && "bg-loss/15 text-loss",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  )
}

function statusChip(l?: Listing) {
  if (!l) return <Chip tone="muted">Not listed</Chip>
  switch (l.status) {
    case "active": return <Chip tone="live">Live{l.price_cents ? ` · ${formatCents(l.price_cents)}` : ""}</Chip>
    case "delist_pending": return <Chip tone="warn">Delist now</Chip>
    case "error": return <Chip tone="warn">Couldn&apos;t end</Chip>
    case "sold": return <Chip tone="live">Sold here</Chip>
    default: return <Chip tone="muted">Ended</Chip>
  }
}

function useRun() {
  const [pending, start] = useTransition()
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string, after?: () => void) =>
    start(async () => {
      const res = await fn()
      if (!res.ok) return void toast.error(res.error ?? "Failed")
      toast.success(msg)
      after?.()
    })
  return [pending, run] as const
}

function LiveActions({ listing, m }: { listing: Listing; m: Marketplace }) {
  const [pending, run] = useRun()
  const api = m.mode === "api"
  const url = listing.external_url ?? m.manageUrl
  if (listing.status === "delist_pending" || listing.status === "error") {
    return (
      <>
        <p className="text-sm text-loss">
          {listing.status === "error"
            ? `We couldn't end this listing: ${listing.last_error ?? "unknown error"}.`
            : `This item sold elsewhere. Take the ${m.short} listing down so nobody else buys it.`}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <a href={url} target="_blank" rel="noopener noreferrer" className="flex h-11 items-center justify-center gap-1.5 rounded-xl border font-semibold">
            Open {m.short} <ExternalLink className="size-4" />
          </a>
          <button
            disabled={pending}
            onClick={() => run(() => endListing(listing.id), api ? "Listing ended" : "Marked delisted")}
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-ink font-semibold text-white disabled:opacity-60"
          >
            <Check className="size-4" /> {api ? "Retry" : "It's delisted"}
          </button>
          {listing.status === "error" && (
            <button
              disabled={pending}
              onClick={() => run(() => endListing(listing.id, { manual: true }), "Marked ended")}
              className="col-span-2 text-xs font-semibold text-muted-foreground"
            >
              Already ended it on {m.short} yourself? Mark ended
            </button>
          )}
        </div>
      </>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <a href={url} target="_blank" rel="noopener noreferrer" className="flex h-11 items-center justify-center gap-1.5 rounded-xl border font-semibold">
        View <ExternalLink className="size-4" />
      </a>
      <button
        disabled={pending}
        onClick={() => {
          if (!confirm(api ? `End the ${m.label} listing now?` : `Did you end the ${m.label} listing?`)) return
          run(() => endListing(listing.id), api ? "Listing ended" : "Marked delisted")
        }}
        className="flex h-11 items-center justify-center gap-1.5 rounded-xl border font-semibold text-destructive disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null} {api ? "End listing" : "I ended it"}
      </button>
      {!api && (
        <button
          disabled={pending}
          onClick={() => run(() => forgetListing(listing.id), "Removed")}
          className="col-span-2 text-xs font-semibold text-muted-foreground"
        >
          Not actually listed? Remove
        </button>
      )}
    </div>
  )
}

// ---------- Assisted marketplaces (no API): photo + copy kit, then the user confirms ----------

function AssistedRow({
  item, m, listing, draft, saveDraft,
}: {
  item: Item
  m: Marketplace
  listing?: Listing
  draft: Draft
  saveDraft: () => Promise<boolean>
}) {
  const needsAttention = listing?.status === "delist_pending"
  const [open, setOpen] = useState(needsAttention)
  const live = listing && ["active", "delist_pending", "error"].includes(listing.status)
  return (
    <RowShell m={m} status={statusChip(listing)} open={open} onToggle={() => setOpen((o) => !o)}>
      {live ? <LiveActions listing={listing} m={m} /> : item.status === "inventory" && <ListingKit item={item} m={m} draft={draft} saveDraft={saveDraft} />}
    </RowShell>
  )
}

function ListingKit({ item, m, draft, saveDraft }: { item: Item; m: Marketplace; draft: Draft; saveDraft: () => Promise<boolean> }) {
  const [url, setUrl] = useState("")
  const [pending, run] = useRun()
  const [files, setFiles] = useState<File[] | null>(null)
  const photos = item.photo_urls.slice(0, m.photoLimit)

  // Fetch photos up front so the share sheet opens straight from the tap (iOS requires that).
  useEffect(() => {
    let cancelled = false
    Promise.all(
      photos.map(async (u, i) => {
        const b = await (await fetch(u)).blob()
        return new File([b], `photo-${i + 1}.jpg`, { type: b.type || "image/jpeg" })
      }),
    ).then((f) => !cancelled && setFiles(f), () => !cancelled && setFiles([]))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.join("|")])

  async function sharePhotos() {
    if (!files?.length) return
    try {
      if (navigator.canShare?.({ files })) return void (await navigator.share({ files, title: draft.title }))
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return
    }
    for (const f of files) {
      const a = document.createElement("a")
      a.href = URL.createObjectURL(f)
      a.download = `${(draft.title || "item").slice(0, 40)}-${f.name}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    }
  }

  const btn = "flex h-11 items-center justify-center gap-1.5 rounded-xl border bg-card px-2 text-sm font-semibold"
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {m.label} has no public listing API, so you post it and FlipLedger keeps track. When the item sells anywhere, you&apos;ll get a reminder to take this one down.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={sharePhotos} disabled={!files?.length} className={cn(btn, "col-span-2 disabled:opacity-50")}>
          {files === null && photos.length ? <Loader2 className="size-4 animate-spin" /> : <Images className="size-4" />}
          {photos.length ? `Save / share ${photos.length} photo${photos.length === 1 ? "" : "s"}` : "No photos yet"}
          {item.photo_urls.length > m.photoLimit && <span className="text-muted-foreground">(max {m.photoLimit})</span>}
        </button>
        <button type="button" onClick={() => copy(draft.title, "title")} className={btn}><Copy className="size-4" /> Title</button>
        <button type="button" onClick={() => copy(listingText(draft), "description")} className={btn}><Copy className="size-4" /> Description</button>
        <button type="button" onClick={() => copy(draft.price ? (toCents(draft.price) / 100).toFixed(2) : "", "price")} className={btn}>
          <Copy className="size-4" /> Price
        </button>
        <a href={m.sellUrl} target="_blank" rel="noopener noreferrer" className={cn(btn, "bg-ink text-white")}>
          Open {m.short} <ExternalLink className="size-4" />
        </a>
      </div>
      <div className="flex gap-2">
        <TextInput
          type="url" inputMode="url" placeholder={`${m.short} listing link (optional)`}
          value={url} onChange={(e) => setUrl(e.target.value)} className="h-11"
        />
        <button
          disabled={pending}
          onClick={() =>
            run(async () => {
              if (!(await saveDraft())) return { ok: false, error: "Couldn't save details" }
              return markAssistedListed(item.id, { marketplace: m.id, url, priceCents: draft.price ? toCents(draft.price) : null })
            }, `Tracking it on ${m.short}`)
          }
          className="h-11 shrink-0 rounded-xl bg-profit px-4 font-bold text-white disabled:opacity-60"
        >
          I listed it
        </button>
      </div>
    </>
  )
}

// ---------- eBay (API): we publish and end listings for the user ----------

function EbayRow({
  item, listing, status, draft, saveDraft,
}: {
  item: Item
  listing?: Listing
  status: EbayStatus | null
  draft: Draft
  saveDraft: () => Promise<boolean>
}) {
  const m = MARKETPLACES[0]
  const live = listing && ["active", "error"].includes(listing.status)
  const [open, setOpen] = useState(listing?.status === "error")

  let body: React.ReactNode
  if (live) body = <LiveActions listing={listing} m={m} />
  else if (item.status !== "inventory") body = null
  else if (!status) body = <p className="text-sm text-muted-foreground">Checking your eBay connection…</p>
  else if (!status.configured) body = <p className="text-sm text-muted-foreground">eBay listing isn&apos;t switched on for this app yet (API keys pending).</p>
  else if (!status.connected)
    body = (
      <Link href="/settings#marketplaces" className="flex h-11 items-center justify-center rounded-xl bg-blue-600 font-bold text-white">
        Connect eBay in Settings
      </Link>
    )
  else if (status.gaps.length)
    body = (
      <p className="text-sm">
        Almost there: add {status.gaps.join(", ")} in{" "}
        <Link href="/settings#marketplaces" className="font-semibold text-profit underline">Settings</Link>.
      </p>
    )
  else body = <EbayPublish item={item} draft={draft} saveDraft={saveDraft} sandbox={status.sandbox} />

  return (
    <RowShell m={m} status={statusChip(listing)} open={open} onToggle={() => setOpen((o) => !o)}>
      {body}
    </RowShell>
  )
}

function EbayPublish({ item, draft, saveDraft, sandbox }: { item: Item; draft: Draft; saveDraft: () => Promise<boolean>; sandbox: boolean }) {
  const [q, setQ] = useState(draft.title)
  const [cats, setCats] = useState<CategorySuggestion[] | null>(null)
  const [cat, setCat] = useState<CategorySuggestion | null>(null)
  const [aspects, setAspects] = useState<Aspect[] | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [price, setPrice] = useState(draft.price)
  const [busy, startBusy] = useTransition()

  function findCategories() {
    startBusy(async () => {
      const res = await ebayCategories(q)
      if (!res.ok) return void toast.error(res.error)
      setCats(res.data)
      if (!res.data.length) toast.message("No categories found. Try fewer words")
    })
  }

  function pickCategory(c: CategorySuggestion) {
    setCat(c)
    setAspects(null)
    startBusy(async () => {
      const res = await ebayAspects(c.id)
      if (!res.ok) return void toast.error(res.error)
      setAspects(res.data)
      setValues((v) => ({
        ...Object.fromEntries(res.data.map((a) => [a.name, a.name === "Brand" ? draft.brand : a.name === "Size" ? draft.size : ""])),
        ...Object.fromEntries(Object.entries(v).filter(([, x]) => x)),
      }))
    })
  }

  const missing = aspects?.filter((a) => a.required && !values[a.name]?.trim()).map((a) => a.name) ?? []

  function publish() {
    if (!cat) return void toast.error("Pick an eBay category")
    if (missing.length) return void toast.error(`Fill in ${missing.join(", ")}`)
    startBusy(async () => {
      if (!(await saveDraft())) return
      const res = await publishEbay(item.id, {
        categoryId: cat.id,
        priceCents: toCents(price),
        aspects: Object.fromEntries(
          Object.entries(values).map(([k, v]) => [k, v.split(",").map((x) => x.trim()).filter(Boolean)]),
        ),
      })
      if (!res.ok) return void toast.error(res.error)
      toast.success(sandbox ? "Listed on eBay (sandbox)" : "Listed on eBay!")
    })
  }

  if (!item.photo_paths.length) return <p className="text-sm text-muted-foreground">Add at least one photo (Edit item) before listing on eBay.</p>
  if (!draft.title.trim()) return <p className="text-sm text-muted-foreground">Add a title above first.</p>

  return (
    <>
      {sandbox && <p className="rounded-xl bg-brand-soft px-3 py-2 text-xs font-semibold text-brand">Sandbox mode: test listings only.</p>}
      <div>
        <FieldLabel>Category</FieldLabel>
        {cat ? (
          <button type="button" onClick={() => { setCat(null); setAspects(null) }} className="w-full rounded-xl border bg-muted/60 px-3 py-2 text-left text-sm">
            <span className="font-semibold">{cat.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{cat.path} · change</span>
          </button>
        ) : (
          <>
            <div className="flex gap-2">
              <TextInput value={q} onChange={(e) => setQ(e.target.value)} className="h-11" placeholder="Describe the item" />
              <button type="button" onClick={findCategories} disabled={busy} className="grid size-11 shrink-0 place-items-center rounded-xl bg-ink text-white disabled:opacity-60" aria-label="Find categories">
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              </button>
            </div>
            {cats && (
              <div className="mt-2 flex flex-col gap-1">
                {cats.map((c) => (
                  <button key={c.id} type="button" onClick={() => pickCategory(c)} className="rounded-xl border px-3 py-2 text-left text-sm hover:bg-muted">
                    <span className="font-semibold">{c.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{c.path}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {cat && !aspects && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading item specifics…</p>}
      {aspects && aspects.length > 0 && (
        <div className="flex flex-col gap-2">
          <FieldLabel className="mb-0">Item specifics</FieldLabel>
          {aspects.map((a) => (
            <div key={a.name}>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                {a.name}{a.required && <span className="text-loss"> *</span>}{a.multi && " (comma separated)"}
              </label>
              {!a.freeText && a.values.length && !a.multi ? (
                <NativeSelect value={values[a.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [a.name]: e.target.value }))} className="h-11">
                  <option value="">Choose…</option>
                  {a.values.map((x) => <option key={x}>{x}</option>)}
                </NativeSelect>
              ) : (
                <>
                  <TextInput
                    list={`asp-${a.name}`} className="h-11" value={values[a.name] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [a.name]: e.target.value }))}
                  />
                  <datalist id={`asp-${a.name}`}>{a.values.slice(0, 50).map((x) => <option key={x} value={x} />)}</datalist>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div>
        <FieldLabel>eBay price</FieldLabel>
        <MoneyInput value={price} onChange={setPrice} />
      </div>
      <button
        type="button" onClick={publish} disabled={busy || !cat || !aspects || !price}
        className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 font-bold text-white disabled:opacity-50"
      >
        {busy && <Loader2 className="size-4 animate-spin" />} List on eBay · {item.quantity} unit{item.quantity === 1 ? "" : "s"}
      </button>
    </>
  )
}
