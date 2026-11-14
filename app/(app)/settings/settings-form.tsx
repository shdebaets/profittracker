"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { saveSettings } from "@/app/(app)/actions/expenses"
import { FieldLabel, MoneyInput, NativeSelect } from "@/components/fields"
import { centsToInput, toCents } from "@/lib/money"
import { TAX_BRACKETS } from "@/lib/tax"
import type { Settings } from "@/lib/types"

export function SettingsForm({ settings }: { settings: Settings }) {
  const [rate, setRate] = useState(centsToInput(settings.mileage_rate_cents))
  const [days, setDays] = useState(String(settings.default_return_days))
  const [bracket, setBracket] = useState(String(settings.tax_bracket))
  const [pending, startTransition] = useTransition()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        startTransition(async () => {
          const res = await saveSettings({ mileageRateCents: toCents(rate), defaultReturnDays: Number(days) || 0, taxBracket: Number(bracket) })
          if (res.ok) toast.success("Settings saved")
          else toast.error(res.error)
        })
      }}
      className="flex flex-col gap-4 rounded-3xl border bg-card p-5 shadow-sm"
    >
      <div>
        <FieldLabel htmlFor="rate">Mileage Rate (Per Mile)</FieldLabel>
        <MoneyInput id="rate" value={rate} onChange={setRate} />
        <p className="mt-1 text-xs text-muted-foreground">Use the current IRS standard business mileage rate.</p>
      </div>
      <div>
        <FieldLabel htmlFor="days">Default Return Window (Days)</FieldLabel>
        <input
          id="days" inputMode="numeric" value={days}
          onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))}
          className="h-12 w-full rounded-2xl border bg-muted/60 px-4 font-mono font-semibold outline-none"
        />
      </div>
      <div>
        <FieldLabel htmlFor="bracket">Federal Tax Bracket</FieldLabel>
        <NativeSelect id="bracket" value={bracket} onChange={(e) => setBracket(e.target.value)}>
          {TAX_BRACKETS.map((b) => (
            <option key={b} value={String(b)}>{Math.round(b * 100)}%</option>
          ))}
        </NativeSelect>
        <p className="mt-1 text-xs text-muted-foreground">
          Used for your tax savings and quarterly estimates. {settings.tax_bracket_set ? "" : "Not sure? 22% is a common middle bracket."}
        </p>
      </div>
      <button disabled={pending} className="h-12 rounded-2xl bg-brand font-bold text-ink disabled:opacity-60">
        {pending ? "Saving…" : "Save Settings"}
      </button>
    </form>
  )
}
