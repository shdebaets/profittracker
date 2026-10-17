"use client"

import { DollarSign, Package, PackagePlus, Pencil, Share2, Sparkles } from "lucide-react"
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { BottomSheet } from "@/components/bottom-sheet"
import { CrosslistPanel } from "@/components/crosslist/crosslist-panel"
import type { Item } from "@/lib/types"
import { EntryForm, type EntryMode, type Prefill } from "./entry-form"
import { HaulForm } from "./haul-form"
import { ItemDetail } from "./item-detail"

type SheetState =
  | { kind: "none" }
  | { kind: "create"; mode: EntryMode; prefill?: Prefill }
  | { kind: "haul" }
  | { kind: "item"; item: Item }
  | { kind: "sell"; item: Item }
  | { kind: "edit"; item: Item }
  | { kind: "crosslist"; item: Item }

type Ctx = {
  openEntry: (mode?: EntryMode, prefill?: Prefill) => void
  openHaul: () => void
  openItem: (item: Item) => void
  /** Pages hand over their latest items so an open sheet re-renders after a save. */
  syncItems: (items: Item[]) => void
}

const EntryContext = createContext<Ctx | null>(null)

export function useEntry() {
  const ctx = useContext(EntryContext)
  if (!ctx) throw new Error("useEntry must be used inside EntryProvider")
  return ctx
}

/** Keep any open item sheet in step with fresh server data. */
export function useSyncItems(items: Item[]) {
  const { syncItems } = useEntry()
  useEffect(() => syncItems(items), [items, syncItems])
}

export function EntryProvider({ defaultReturnDays, children }: { defaultReturnDays: number; children: React.ReactNode }) {
  const [state, setState] = useState<SheetState>({ kind: "none" })
  // Keep the last content mounted while the sheet animates closed.
  const [shown, setShown] = useState<Exclude<SheetState, { kind: "none" }> | null>(null)
  const [formKey, setFormKey] = useState(0)
  const [fresh, setFresh] = useState<Map<string, Item>>(new Map())

  const show = useCallback((s: Exclude<SheetState, { kind: "none" }>) => {
    setFormKey((k) => k + 1)
    setShown(s)
    setState(s)
  }, [])
  const close = useCallback(() => setState({ kind: "none" }), [])

  const ctx = useMemo<Ctx>(
    () => ({
      openEntry: (mode = "sold", prefill) => show({ kind: "create", mode, prefill }),
      openHaul: () => show({ kind: "haul" }),
      openItem: (item) => show({ kind: "item", item }),
      syncItems: (items) => setFresh(new Map(items.map((i) => [i.id, i]))),
    }),
    [show],
  )

  const s = shown && "item" in shown ? { ...shown, item: fresh.get(shown.item.id) ?? shown.item } : shown
  let header: { title: string; description: string; icon: React.ReactNode; iconClass: string } = {
    title: "", description: "", icon: null, iconClass: "",
  }
  let body: React.ReactNode = null

  if (s?.kind === "create") {
    header =
      s.mode === "sold"
        ? { title: "Log Resell Sale", description: "Record a completed sale and lock in your net profit", icon: <DollarSign className="size-5 text-profit" />, iconClass: "bg-profit-soft" }
        : { title: "Add to Inventory", description: "Track unsold stock and what you paid", icon: <PackagePlus className="size-5 text-brand" />, iconClass: "bg-brand-soft" }
    body = (
      <EntryForm
        key={formKey} variant="create" initialMode={s.mode} prefill={s.prefill}
        defaultReturnDays={defaultReturnDays} onDone={close}
        onModeChange={(mode) => setShown({ ...s, mode })}
        onHaul={() => show({ kind: "haul" })}
      />
    )
  } else if (s?.kind === "haul") {
    header = { title: "Log a Haul", description: "One receipt, many items: we split the cost for you", icon: <Sparkles className="size-5 text-brand" />, iconClass: "bg-brand-soft" }
    body = <HaulForm key={formKey} defaultReturnDays={defaultReturnDays} onDone={close} />
  } else if (s?.kind === "item") {
    header = {
      title: s.item.title || `Item #${s.item.seq}`,
      description: `#${s.item.seq} · ${s.item.status === "sold" ? "Sold" : s.item.status === "returned" ? "Returned" : "In inventory"}`,
      ...(s.item.status === "sold"
        ? { icon: <DollarSign className="size-5 text-profit" />, iconClass: "bg-profit-soft" }
        : s.item.status === "inventory"
          ? { icon: <Package className="size-5 text-brand" />, iconClass: "bg-brand-soft" }
          : { icon: <Package className="size-5 text-muted-foreground" />, iconClass: "bg-muted" }),
    }
    body = (
      <ItemDetail
        item={s.item} onDone={close}
        onSell={() => show({ kind: "sell", item: s.item })}
        onEdit={() => show({ kind: "edit", item: s.item })}
        onCrosslist={() => show({ kind: "crosslist", item: s.item })}
      />
    )
  } else if (s?.kind === "sell") {
    header = { title: "Mark as Sold", description: "Sell some or all units from this lot", icon: <DollarSign className="size-5 text-profit" />, iconClass: "bg-profit-soft" }
    body = <EntryForm key={formKey} variant="sell" item={s.item} defaultReturnDays={defaultReturnDays} onDone={close} />
  } else if (s?.kind === "crosslist") {
    header = { title: "Cross-list", description: s.item.title || `Item #${s.item.seq}`, icon: <Share2 className="size-5 text-brand" />, iconClass: "bg-brand-soft" }
    body = <CrosslistPanel key={formKey} item={s.item} onBack={() => show({ kind: "item", item: s.item })} />
  } else if (s?.kind === "edit") {
    header = { title: "Edit Entry", description: `#${s.item.seq}`, icon: <Pencil className="size-5 text-muted-foreground" />, iconClass: "bg-muted" }
    body = <EntryForm key={formKey} variant="edit" item={s.item} defaultReturnDays={defaultReturnDays} onDone={close} />
  }

  return (
    <EntryContext.Provider value={ctx}>
      {children}
      <BottomSheet
        open={state.kind !== "none"}
        onOpenChange={(o) => !o && close()}
        {...header}
      >
        {body}
      </BottomSheet>
    </EntryContext.Provider>
  )
}
