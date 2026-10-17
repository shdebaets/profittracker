"use client"

import { Link2, PackagePlus, RotateCcw, Sparkles, TrendingUp, DollarSign, ChevronDown } from "lucide-react"
import { useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"
import { createItem, markSold, updateItem, type ItemInput } from "@/app/(app)/actions/items"
import { discardPhotos } from "@/app/(app)/actions/photos"
import { FeePresetGrid } from "@/components/fee-preset-grid"
import { FieldLabel, MoneyInput, QtyPicker, Segmented, TextInput, Toggle } from "@/components/fields"
import { addDays, dateInputToIso, toDateInput } from "@/lib/dates"
import { centsToInput, formatCents, formatPct, toCents } from "@/lib/money"
import { calcSale, presetFor } from "@/lib/profit"
import type { Item, Platform } from "@/lib/types"
import { marketplace, type MarketplaceId } from "@/lib/marketplaces/registry"
import { cn } from "@/lib/utils"
import { PhotoPicker, type Photo } from "./photo-picker"

export type EntryMode = "sold" | "inventory"

export type Prefill = Partial<{
  cost: string
  price: string
  qty: number
  buyerShip: string
  labelCost: string
  platform: Platform
  customPct: string
}>

type Props =
  | { variant: "create"; initialMode?: EntryMode; prefill?: Prefill; defaultReturnDays: number; onDone: () => void; onModeChange?: (m: EntryMode) => void; onHaul?: () => void }
  | { variant: "edit"; item: Item; defaultReturnDays: number; onDone: () => void }
  | { variant: "sell"; item: Item; defaultReturnDays: number; onDone: () => void }

function initialFromItem(item: Item) {
  const isCustom = item.platform === "custom"
  return {
    title: item.title ?? "",
    link: item.link_url ?? "",
    store: item.store ?? "",
    cost: centsToInput(item.cost_cents),
    price: centsToInput(item.sale_price_cents),
    qty: item.quantity,
    buyerShip: centsToInput(item.buyer_shipping_cents),
    labelCost: centsToInput(item.label_cost_cents),
    platform: (item.platform ?? "cash") as Platform,
    customPct: isCustom ? String(+(Number(item.fee_pct) * 100).toFixed(3)) : "",
    returnable: item.returnable,
    returnDeadline: item.return_deadline ?? "",
    purchasedAt: toDateInput(new Date(item.purchased_at)),
    photos: item.photo_paths.map((path, i) => ({ path, url: item.photo_urls[i] ?? "" })),
  }
}

export function EntryForm(props: Props) {
  const item = props.variant === "create" ? null : props.item
  const init = item
    ? initialFromItem(item)
    : {
        title: "", link: "", store: "",
        cost: props.variant === "create" ? (props.prefill?.cost ?? "") : "",
        price: props.variant === "create" ? (props.prefill?.price ?? "") : "",
        qty: props.variant === "create" ? (props.prefill?.qty ?? 1) : 1,
        buyerShip: props.variant === "create" ? (props.prefill?.buyerShip ?? "") : "",
        labelCost: props.variant === "create" ? (props.prefill?.labelCost ?? "") : "",
        platform: (props.variant === "create" ? props.prefill?.platform : undefined) ?? ("cash" as Platform),
        customPct: props.variant === "create" ? (props.prefill?.customPct ?? "") : "",
        returnable: false, returnDeadline: "", purchasedAt: toDateInput(new Date()),
        photos: [] as Photo[],
      }

  const [mode, setModeState] = useState<EntryMode>(
    props.variant === "create" ? (props.initialMode ?? "sold") : props.variant === "sell" ? "sold" : (item!.status === "sold" ? "sold" : "inventory"),
  )
  const [title, setTitle] = useState(init.title)
  const [link, setLink] = useState(init.link)
  const [showLink, setShowLink] = useState(!!init.link)
  const [store, setStore] = useState(init.store)
  const [cost, setCost] = useState(init.cost)
  const [price, setPrice] = useState(props.variant === "sell" ? "" : init.price)
  const [qty, setQty] = useState(props.variant === "sell" ? 1 : init.qty)
  const [buyerShip, setBuyerShip] = useState(init.buyerShip)
  const [labelCost, setLabelCost] = useState(init.labelCost)
  const [platform, setPlatform] = useState<Platform>(init.platform)
  const [customPct, setCustomPct] = useState(init.customPct)
  const [showMore, setShowMore] = useState(!!(init.buyerShip || init.labelCost || init.platform !== "cash"))
  const [returnable, setReturnable] = useState(init.returnable)
  const [returnDeadline, setReturnDeadline] = useState(init.returnDeadline)
  const [purchasedAt, setPurchasedAt] = useState(init.purchasedAt)
  const [photos, setPhotos] = useState<Photo[]>(init.photos)
  // Photos uploaded in this form but not saved yet; discarded if the sheet closes without saving.
  const unsaved = useRef(new Set<string>())
  useEffect(() => {
    const pendingUploads = unsaved.current
    return () => {
      if (pendingUploads.size) void discardPhotos([...pendingUploads])
    }
  }, [])
  const liveListings = props.variant === "sell" ? props.item.listings.filter((l) => l.status === "active") : []
  const [soldOn, setSoldOnState] = useState<MarketplaceId | null>(null)
  const setSoldOn = (m: MarketplaceId | null) => {
    setSoldOnState(m)
    if (m) {
      setPlatform(marketplace(m).feePreset)
      setShowMore(true)
    }
  }
  const [pending, startTransition] = useTransition()

  const setMode = (m: EntryMode) => {
    setModeState(m)
    if (props.variant === "create") props.onModeChange?.(m)
  }

  const preset = presetFor(platform)
  const feePct = platform === "custom" ? (Number(customPct) || 0) / 100 : preset.pct
  const feeFixed = preset.fixedCents
  const costCents = toCents(cost)
  const sale = calcSale({
    costCents,
    salePriceCents: toCents(price),
    quantity: qty,
    buyerShippingCents: toCents(buyerShip),
    labelCostCents: toCents(labelCost),
    feePct,
    feeFixedCents: feeFixed,
  })
  const isSale = mode === "sold"
  const selling = props.variant === "sell"

  function toggleReturn(v: boolean) {
    setReturnable(v)
    if (v && !returnDeadline) setReturnDeadline(addDays(props.defaultReturnDays, new Date(dateInputToIso(purchasedAt))))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const saleInput = {
      salePriceCents: toCents(price),
      buyerShippingCents: toCents(buyerShip),
      labelCostCents: toCents(labelCost),
      feePct,
      feeFixedCents: feeFixed,
      platform,
    }
    if (isSale && !saleInput.salePriceCents) {
      toast.error("Enter the sale price")
      return
    }
    startTransition(async () => {
      let res
      if (props.variant === "sell") {
        res = await markSold(props.item.id, { quantity: qty, soldOn, ...saleInput })
        const o = res.ok ? res.outcome : undefined
        if (o && o.remaining === 0) {
          const name = (id: MarketplaceId) => marketplace(id).short
          if (o.ended.length) toast.success(`Ended on ${o.ended.map(name).join(", ")}`)
          if (o.needsDelist.length) toast.warning(`Now delist it on ${o.needsDelist.map(name).join(", ")}`, { duration: 8000 })
          for (const f of o.failed) toast.error(`Couldn't end on ${name(f.marketplace)}: ${f.error}`, { duration: 10000 })
        }
      } else {
        const input: ItemInput = {
          mode,
          title: title || undefined,
          linkUrl: link || undefined,
          store: store || undefined,
          costCents,
          quantity: qty,
          returnable,
          returnDeadline: returnable ? returnDeadline || null : null,
          purchasedAt: item && purchasedAt === init.purchasedAt ? item.purchased_at : dateInputToIso(purchasedAt),
          photoPaths: photos.map((p) => p.path),
          sale: isSale
            ? {
                ...saleInput,
                // keep the original sale timestamp when editing
                soldAt: props.variant === "edit" ? (props.item.sold_at ?? undefined) : undefined,
              }
            : undefined,
        }
        res = props.variant === "edit" ? await updateItem(props.item.id, input) : await createItem(input)
      }
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      unsaved.current.clear()
      toast.success(
        props.variant === "edit" ? "Saved" : isSale ? `Cha-ching! ${formatCents(sale.net)} profit logged` : "Added to inventory",
      )
      props.onDone()
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {props.variant === "create" && (
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "sold", label: <span className={cn("flex items-center gap-1.5", mode === "sold" && "text-profit")}><DollarSign className="size-4 shrink-0" /><span className="leading-tight">Record Sale<span className="block text-xs font-medium opacity-70">(Sold)</span></span></span> },
            { value: "inventory", label: <span className={cn("flex items-center gap-1.5", mode === "inventory" && "text-brand")}><PackagePlus className="size-4 shrink-0" /><span className="leading-tight">Add Inventory<span className="block text-xs font-medium opacity-70">(Unsold)</span></span></span> },
          ]}
        />
      )}

      {props.variant === "create" && mode === "inventory" && props.onHaul && (
        <button
          type="button" onClick={props.onHaul}
          className="flex items-center gap-3 rounded-2xl border border-brand/40 bg-brand-soft p-3 text-left"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand/20"><Sparkles className="size-4 text-brand" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold">Got a receipt for a whole sourcing haul?</span>
            <span className="block truncate text-xs text-muted-foreground">Log a Haul to auto-distribute the lump-sum cost</span>
          </span>
          <span className="rounded-xl bg-brand px-3 py-2 text-sm font-bold text-ink">Log Haul</span>
        </button>
      )}

      {selling ? (
        <div className="rounded-2xl border bg-card p-4">
          <p className="font-semibold">{props.item.title || `Item #${props.item.seq}`}</p>
          <p className="text-sm text-muted-foreground">
            Cost {formatCents(props.item.cost_cents)} / unit · {props.item.quantity} in stock
          </p>
        </div>
      ) : (
        <>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <FieldLabel htmlFor="title" className="mb-0">Item Title / Description <span className="font-normal text-muted-foreground">(Optional)</span></FieldLabel>
              {!showLink && (
                <button type="button" onClick={() => setShowLink(true)} className="flex items-center gap-1 text-sm font-semibold text-profit">
                  <Link2 className="size-4" /> Track by Link
                </button>
              )}
            </div>
            <TextInput id="title" placeholder="e.g. Vintage Nike Tee, Levi's 501" value={title} onChange={(e) => setTitle(e.target.value)} />
            {showLink && (
              <TextInput className="mt-2" type="url" inputMode="url" placeholder="Paste a listing or tracking link" value={link} onChange={(e) => setLink(e.target.value)} />
            )}
          </div>
          <div>
            <FieldLabel>Photos <span className="font-normal text-muted-foreground">(Optional)</span></FieldLabel>
            <PhotoPicker
              value={photos}
              onChange={(next) => {
                // A fresh upload removed before saving can go right away.
                const removed = photos.filter((p) => !next.some((n) => n.path === p.path) && unsaved.current.has(p.path))
                removed.forEach((p) => unsaved.current.delete(p.path))
                if (removed.length) void discardPhotos(removed.map((p) => p.path))
                setPhotos(next)
              }}
              onUploaded={(paths) => paths.forEach((p) => unsaved.current.add(p))}
            />
          </div>
          <div>
            <FieldLabel htmlFor="cost">Purchase Cost (COG) {qty > 1 && <span className="font-normal text-muted-foreground">per unit</span>}</FieldLabel>
            <MoneyInput id="cost" big value={cost} onChange={setCost} />
          </div>
        </>
      )}

      {isSale ? (
        <div>
          <FieldLabel htmlFor="price">Sale Price (Revenue) {qty > 1 && <span className="font-normal text-muted-foreground">per unit</span>}</FieldLabel>
          <MoneyInput id="price" big value={price} onChange={setPrice} autoFocus={selling} />
        </div>
      ) : (
        <div className="rounded-2xl border border-brand/40 bg-brand-soft p-4">
          <p className="font-bold text-brand">Inventory Item</p>
          <p className="text-sm text-muted-foreground">Sale price will be recorded when this item is marked as sold.</p>
        </div>
      )}

      {selling && liveListings.length > 0 && (
        <div>
          <FieldLabel>Where did it sell?</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {liveListings.map((l) => (
              <button
                key={l.id} type="button" onClick={() => setSoldOn(l.marketplace)}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-semibold",
                  soldOn === l.marketplace ? marketplace(l.marketplace).badge : "border bg-card",
                )}
              >
                {marketplace(l.marketplace).label}
              </button>
            ))}
            <button
              type="button" onClick={() => setSoldOn(null)}
              className={cn("rounded-full px-4 py-2 text-sm font-semibold", soldOn === null ? "bg-ink text-white" : "border bg-card")}
            >
              Somewhere else
            </button>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {qty < props.item.quantity
              ? "Units left stay listed."
              : "We'll take it down on your other marketplaces."}
          </p>
        </div>
      )}

      <QtyPicker
        value={qty}
        onChange={setQty}
        max={selling ? props.item.quantity : undefined}
        label={selling ? "Units sold" : "Quantity"}
      />

      {isSale && (
        <>
          <button
            type="button" onClick={() => setShowMore((v) => !v)}
            className="flex items-center justify-between rounded-2xl border bg-card px-4 py-3 text-sm font-semibold"
          >
            Fees & Shipping
            <span className="flex items-center gap-2 text-muted-foreground">
              {preset.label.split(" ")[0]}
              <ChevronDown className={cn("size-4 transition", showMore && "rotate-180")} />
            </span>
          </button>
          {showMore && (
            <>
              <FeePresetGrid
                platform={platform} onPlatform={setPlatform}
                customPct={customPct} onCustomPct={setCustomPct} effectivePct={feePct}
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>Buyer paid shipping</FieldLabel>
                  <MoneyInput value={buyerShip} onChange={setBuyerShip} placeholder="0" />
                </div>
                <div>
                  <FieldLabel>Your label cost</FieldLabel>
                  <MoneyInput value={labelCost} onChange={setLabelCost} placeholder="0" />
                </div>
              </div>
            </>
          )}
        </>
      )}

      {!selling && (
        <div>
          <FieldLabel htmlFor="store">Bought At <span className="font-normal text-muted-foreground">(Optional)</span></FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            <TextInput id="store" placeholder="Store name" value={store} onChange={(e) => setStore(e.target.value)} />
            <TextInput type="date" aria-label="Purchase date" className="px-3 text-[15px]" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} />
          </div>
        </div>
      )}

      {isSale && (
        <div className="flex items-center gap-3 rounded-2xl border border-profit/30 bg-profit-soft p-4">
          <TrendingUp className="size-6 shrink-0 text-profit" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-profit">Estimated Net Profit</p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {formatCents(sale.revenue)} rev − {formatCents(sale.cog)} cost
              {sale.fees ? ` − ${formatCents(sale.fees)} fees` : ""}
              {sale.shipping ? ` − ${formatCents(sale.shipping)} ship` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className={cn("font-mono text-xl font-bold", sale.net < 0 ? "text-loss" : "text-profit")}>{formatCents(sale.net)}</p>
            <p className="font-mono text-xs text-muted-foreground">{formatPct(sale.margin)} margin</p>
          </div>
        </div>
      )}

      {!selling && !(props.variant === "edit" && isSale) && (
        <div className="rounded-2xl border bg-card p-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted"><RotateCcw className="size-5 text-muted-foreground" /></span>
            <div className="flex-1">
              <p className="font-semibold">Qualifies for Returns</p>
              <p className="text-sm text-muted-foreground">Counts down return window deadline</p>
            </div>
            <Toggle checked={returnable} onChange={toggleReturn} label="Qualifies for returns" />
          </div>
          {returnable && (
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">Return by</span>
              <TextInput type="date" className="w-auto" value={returnDeadline} onChange={(e) => setReturnDeadline(e.target.value)} />
            </div>
          )}
        </div>
      )}

      <button
        type="submit" disabled={pending}
        className={cn(
          "flex h-14 items-center justify-center gap-2 rounded-2xl text-lg font-bold shadow-lg transition active:scale-[0.99] disabled:opacity-60",
          isSale ? "bg-profit text-white shadow-profit/25" : "bg-brand text-ink shadow-brand/25",
        )}
      >
        {isSale ? <Sparkles className="size-5" /> : <PackagePlus className="size-5" />}
        {pending
          ? "Saving…"
          : props.variant === "edit"
            ? "Save changes"
            : selling
              ? "Mark Sold & Cha-Ching!"
              : isSale
                ? "Log Sale & Cha-Ching!"
                : "Save to Inventory"}
      </button>
    </form>
  )
}
