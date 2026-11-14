"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { saveSettings, sendTestRecap } from "@/app/(app)/actions/expenses"
import { FieldLabel, MoneyInput, NativeSelect, Toggle } from "@/components/fields"
import { centsToInput, toCents } from "@/lib/money"
import { STALE_DAY_OPTIONS } from "@/lib/stale"
import { TAX_BRACKETS } from "@/lib/tax"
import type { Settings } from "@/lib/types"

export function SettingsForm({ settings }: { settings: Settings }) {
  const [rate, setRate] = useState(centsToInput(settings.mileage_rate_cents))
  const [days, setDays] = useState(String(settings.default_return_days))
  const [bracket, setBracket] = useState(String(settings.tax_bracket))
  const [stale, setStale] = useState(String(settings.stale_days))
  const [recap, setRecap] = useState(settings.email_recap)
  const [taxMail, setTaxMail] = useState(settings.email_tax_reminders)
  const [testing, startTest] = useTransition()
  const [pending, startTransition] = useTransition()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        startTransition(async () => {
          const res = await saveSettings({ mileageRateCents: toCents(rate), defaultReturnDays: Number(days) || 0, taxBracket: Number(bracket), staleDays: Number(stale) as 30 | 45 | 60 | 90 | 120, emailRecap: recap, emailTaxReminders: taxMail })
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
      <div>
        <FieldLabel htmlFor="stale">Stale Inventory Alert</FieldLabel>
        <NativeSelect id="stale" value={stale} onChange={(e) => setStale(e.target.value)}>
          {STALE_DAY_OPTIONS.map((d) => (
            <option key={d} value={String(d)}>After {d} days unsold</option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-3 rounded-2xl bg-muted/60 p-4">
        <p className="text-sm font-semibold">Emails</p>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Sunday profit recap</span>
          <Toggle checked={recap} onChange={setRecap} label="Sunday profit recap" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Quarterly tax reminders</span>
          <Toggle checked={taxMail} onChange={setTaxMail} label="Quarterly tax reminders" />
        </label>
        <button
          type="button"
          disabled={testing}
          onClick={() =>
            startTest(async () => {
              const res = await sendTestRecap()
              if (res.ok) toast.success("Sent. Check your inbox.")
              else toast.error(res.error)
            })
          }
          className="self-start text-sm font-semibold text-brand disabled:opacity-60"
        >
          {testing ? "Sending…" : "Email me this week's recap now"}
        </button>
      </div>
      <button disabled={pending} className="h-12 rounded-2xl bg-brand font-bold text-ink disabled:opacity-60">
        {pending ? "Saving…" : "Save Settings"}
      </button>
    </form>
  )
}
