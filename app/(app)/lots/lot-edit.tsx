"use client"

import { Camera, Layers, Receipt, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { deleteHaul, updateHaul } from "@/app/(app)/actions/items"
import { BottomSheet } from "@/components/bottom-sheet"
import { FieldLabel, TextInput } from "@/components/fields"
import { dateInputToIso, toDateInput } from "@/lib/dates"
import { friendlyError, GENERIC_ERROR } from "@/lib/errors"
import type { Haul } from "@/lib/lots"
import { uploadReceipt } from "@/lib/receipt-upload"

type Lot = Haul & { receipt_url: string | null }

/** Edit a lot's name, store, date and receipt, or delete it (its items stay). */
export function LotEditSheet({ lot, units, onClose }: { lot: Lot | null; units: number; onClose: () => void }) {
  return (
    <BottomSheet
      open={lot !== null}
      onOpenChange={(o) => !o && onClose()}
      icon={<Layers className="size-5 text-brand" />}
      iconClass="bg-brand-soft"
      title="Edit lot"
    >
      {lot && <LotEditForm key={lot.id} lot={lot} units={units} onDone={onClose} />}
    </BottomSheet>
  )
}

function LotEditForm({ lot, units, onDone }: { lot: Lot; units: number; onDone: () => void }) {
  const router = useRouter()
  const originalDate = toDateInput(new Date(lot.purchased_at))
  const [title, setTitle] = useState(lot.title ?? "")
  const [store, setStore] = useState(lot.store ?? "")
  const [date, setDate] = useState(originalDate)
  // undefined = keep the current receipt, null = remove it.
  const [receipt, setReceipt] = useState<{ path: string; url: string } | null | undefined>(undefined)
  const [uploading, setUploading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, start] = useTransition()
  const shownReceipt = receipt === undefined ? lot.receipt_url : receipt?.url ?? null

  async function pickReceipt(file: File | undefined) {
    if (!file) return
    setUploading(true)
    try {
      setReceipt(await uploadReceipt(file))
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setUploading(false)
    }
  }

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) =>
    start(async () => {
      const res = await fn()
      if (!res.ok) return void toast.error(res.error ?? GENERIC_ERROR)
      toast.success(msg)
      onDone()
      router.refresh()
    })

  if (confirmDelete) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          Delete <b>{lot.title || lot.store || "this lot"}</b>? Its {units} {units === 1 ? "unit stays" : "units stay"} in your inventory and sales
          with their costs. They just won&apos;t be grouped as a lot any more.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => deleteHaul(lot.id), "Lot deleted. Its items are still here.")}
          className="h-12 rounded-2xl border border-destructive font-bold text-destructive disabled:opacity-50"
        >
          {pending ? "Deleting…" : "Delete lot, keep items"}
        </button>
        <button type="button" onClick={() => setConfirmDelete(false)} className="h-11 text-sm font-semibold text-muted-foreground">
          Go back
        </button>
      </div>
    )
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        run(
          () =>
            updateHaul({
              id: lot.id,
              title,
              store,
              purchasedAt: date && date !== originalDate ? dateInputToIso(date) : undefined,
              receiptPath: receipt === undefined ? undefined : receipt?.path ?? null,
            }),
          "Lot saved",
        )
      }}
    >
      <div>
        <FieldLabel htmlFor="lot-title">Name</FieldLabel>
        <TextInput id="lot-title" value={title} maxLength={200} placeholder="e.g. Goodwill bins run" onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <FieldLabel htmlFor="lot-store">Store</FieldLabel>
          <TextInput id="lot-store" value={store} maxLength={100} onChange={(e) => setStore(e.target.value)} />
        </div>
        <div className="min-w-0">
          <FieldLabel htmlFor="lot-date">Date</FieldLabel>
          <TextInput id="lot-date" type="date" className="px-3 text-[15px]" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">Items that still have the lot&apos;s old store or date get the new one.</p>

      <div className="flex items-center gap-3 rounded-2xl border bg-card p-3">
        <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted">
          {shownReceipt ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shownReceipt} alt="Receipt" className="size-full object-cover" />
          ) : (
            <Receipt className="size-5 text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 flex-1 text-sm">
          <span className="block font-semibold">{shownReceipt ? "Receipt" : "No receipt"}</span>
          <span className="block text-xs text-muted-foreground">{uploading ? "Uploading…" : "Kept with the lot for your records."}</span>
        </span>
        <label className="flex shrink-0 cursor-pointer items-center gap-1 rounded-xl border px-3 py-2 text-sm font-semibold">
          <Camera className="size-4" /> {shownReceipt ? "Replace" : "Add"}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => pickReceipt(e.target.files?.[0])} />
        </label>
      </div>
      {shownReceipt && (
        <button type="button" onClick={() => setReceipt(null)} className="-mt-2 self-start text-sm font-semibold text-muted-foreground">
          Remove receipt
        </button>
      )}

      <button type="submit" disabled={pending || uploading} className="h-12 rounded-2xl bg-brand font-bold text-ink disabled:opacity-60">
        {pending ? "Saving…" : "Save lot"}
      </button>
      <button
        type="button"
        onClick={() => setConfirmDelete(true)}
        className="flex h-11 items-center justify-center gap-2 text-sm font-semibold text-destructive"
      >
        <Trash2 className="size-4" /> Delete lot
      </button>
    </form>
  )
}
