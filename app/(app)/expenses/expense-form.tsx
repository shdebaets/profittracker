"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { saveExpense } from "@/app/(app)/actions/expenses"
import { FieldLabel, MoneyInput, NativeSelect, TextInput } from "@/components/fields"
import { dateInputToIso, toDateInput } from "@/lib/dates"
import { centsToInput, toCents } from "@/lib/money"
import { EXPENSE_CATEGORIES, type Expense } from "@/lib/types"

export function ExpenseForm({ expense, onDone }: { expense: Expense | null; onDone: () => void }) {
  const [title, setTitle] = useState(expense?.title ?? "")
  const [category, setCategory] = useState(expense?.category ?? "Packaging")
  const [amount, setAmount] = useState(centsToInput(expense?.amount_cents))
  const [date, setDate] = useState(toDateInput(expense ? new Date(expense.spent_at) : new Date()))
  const [pending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const res = await saveExpense(expense?.id ?? null, {
        title, category, amountCents: toCents(amount), spentAt: expense && date === toDateInput(new Date(expense.spent_at)) ? expense.spent_at : dateInputToIso(date),
      })
      if (!res.ok) return void toast.error(res.error)
      toast.success(expense ? "Expense updated" : "Expense added")
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <FieldLabel htmlFor="exp-title">Description</FieldLabel>
        <TextInput id="exp-title" required placeholder="Sam's Club: cushion wrap" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <FieldLabel htmlFor="exp-amount">Amount</FieldLabel>
        <MoneyInput id="exp-amount" big value={amount} onChange={setAmount} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel htmlFor="exp-cat">Category</FieldLabel>
          <NativeSelect id="exp-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </NativeSelect>
        </div>
        <div>
          <FieldLabel htmlFor="exp-date">Date</FieldLabel>
          <TextInput id="exp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <button type="submit" disabled={pending} className="h-14 rounded-2xl bg-brand text-lg font-bold text-ink shadow-lg shadow-brand/25 disabled:opacity-60">
        {pending ? "Saving…" : expense ? "Save changes" : "Add Expense"}
      </button>
    </form>
  )
}
