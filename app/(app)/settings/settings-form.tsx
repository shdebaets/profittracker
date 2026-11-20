"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { saveSettings, sendTestRecap } from "@/app/(app)/actions/expenses"
import { FieldLabel, MoneyInput, NativeSelect, Toggle } from "@/components/fields"
import { PushToggle } from "@/components/push-toggle"
import { centsToInput, formatCents, toCents } from "@/lib/money"
import { STALE_DAY_OPTIONS } from "@/lib/stale"
import { bracketFromIncome, FILING_STATUS_LABELS, FILING_STATUSES, TAX_BRACKETS, type FilingStatus } from "@/lib/tax"
import type { Settings } from "@/lib/types"

/** $70,000 rather than $70,000.00 for yearly income lines. */
const dollars = (cents: number) => formatCents(Math.round(cents / 100) * 100).replace(/\.00$/, "")

export function SettingsForm({ settings }: { settings: Settings }) {
  const [rate, setRate] = useState(centsToInput(settings.mileage_rate_cents))
  const [days, setDays] = useState(String(settings.default_return_days))
  const [bracket, setBracket] = useState(String(settings.tax_bracket))
  // Existing sellers who picked a bracket by hand keep seeing it; everyone else starts from income.
  const [manual, setManual] = useState(settings.tax_bracket_set && settings.tax_income_cents === null)
  const [filing, setFiling] = useState<FilingStatus>(settings.tax_filing_status ?? "single")
  const [income, setIncome] = useState(settings.tax_income_cents === null ? "" : centsToInput(settings.tax_income_cents))
  const incomeCents = income.trim() === "" ? null : toCents(income)
  const worked = incomeCents === null ? null : bracketFromIncome(incomeCents, filing)
  const [stale, setStale] = useState(String(settings.stale_days))
  const [recap, setRecap] = useState(settings.email_recap)
  const [taxMail, setTaxMail] = useState(settings.email_tax_reminders)
  const [alerts, setAlerts] = useState(settings.email_alerts)
  const [recapPush, setRecapPush] = useState(settings.push_recap)
  const [taxPush, setTaxPush] = useState(settings.push_tax_reminders)
  const [returnsMail, setReturnsMail] = useState(settings.email_returns)
  const [returnsPush, setReturnsPush] = useState(settings.push_returns)
  const [testing, startTest] = useTransition()
  const [pending, startTransition] = useTransition()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        startTransition(async () => {
          const res = await saveSettings({ mileageRateCents: toCents(rate), defaultReturnDays: Number(days) || 0, taxBracket: Number(bracket), taxFilingStatus: manual || incomeCents === null ? null : filing, taxIncomeCents: manual ? null : incomeCents, staleDays: Number(stale) as 30 | 45 | 60 | 90 | 120, emailRecap: recap, emailTaxReminders: taxMail, pushRecap: recapPush, pushTaxReminders: taxPush, emailAlerts: alerts, emailReturns: returnsMail, pushReturns: returnsPush })
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
      {manual ? (
        <div>
          <FieldLabel htmlFor="bracket">Federal Tax Bracket</FieldLabel>
          <NativeSelect id="bracket" value={bracket} onChange={(e) => setBracket(e.target.value)}>
            {TAX_BRACKETS.map((b) => (
              <option key={b} value={String(b)}>{Math.round(b * 100)}%</option>
            ))}
          </NativeSelect>
          <p className="mt-1 text-xs text-muted-foreground">Used for your tax savings and quarterly estimates.</p>
          <button type="button" onClick={() => setManual(false)} className="mt-1 text-sm font-semibold text-brand">
            Not sure? Work it out from my income
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <FieldLabel htmlFor="filing">Filing Status</FieldLabel>
            <NativeSelect id="filing" value={filing} onChange={(e) => setFiling(e.target.value as FilingStatus)}>
              {FILING_STATUSES.map((f) => (
                <option key={f} value={f}>{FILING_STATUS_LABELS[f]}</option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <FieldLabel htmlFor="income">Expected Yearly Income</FieldLabel>
            <MoneyInput id="income" value={income} onChange={setIncome} placeholder="0" />
            <p className="mt-1 text-xs text-muted-foreground">
              Your total income for the year before deductions: your job plus your reselling profit.{filing === "mfj" ? " Include your spouse's income." : ""}
            </p>
          </div>
          <div className="rounded-2xl bg-muted/60 p-3">
            {worked ? (
              <>
                <p className="text-sm font-semibold">Your federal bracket: <span className="font-mono">{Math.round(worked.rate * 100)}%</span></p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {dollars(incomeCents!)} minus the {dollars(worked.standardDeductionCents)} standard deduction = {dollars(worked.taxableCents)} taxable, using the 2026 IRS brackets. Used for your tax savings and quarterly estimates.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Enter your income to work out your bracket. Until then we use {Math.round(settings.tax_bracket * 100)}%.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              if (worked) setBracket(String(worked.rate))
              setManual(true)
            }}
            className="self-start text-sm font-semibold text-brand"
          >
            Set bracket manually
          </button>
        </div>
      )}
      <div>
        <FieldLabel htmlFor="stale">Stale Inventory Alert</FieldLabel>
        <NativeSelect id="stale" value={stale} onChange={(e) => setStale(e.target.value)}>
          {STALE_DAY_OPTIONS.map((d) => (
            <option key={d} value={String(d)}>After {d} days unsold</option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-3 rounded-2xl bg-muted/60 p-4">
        <p className="text-sm font-semibold">Emails and notifications</p>
        <PushToggle />
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Sunday recap email</span>
          <Toggle checked={recap} onChange={setRecap} label="Sunday recap email" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Sunday recap notification</span>
          <Toggle checked={recapPush} onChange={setRecapPush} label="Sunday recap notification" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Quarterly tax reminder emails</span>
          <Toggle checked={taxMail} onChange={setTaxMail} label="Quarterly tax reminder emails" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Quarterly tax reminder notifications</span>
          <Toggle checked={taxPush} onChange={setTaxPush} label="Quarterly tax reminder notifications" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Weekly stale &amp; overpriced alert</span>
          <Toggle checked={alerts} onChange={setAlerts} label="Weekly stale and overpriced alert" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Return deadline emails</span>
          <Toggle checked={returnsMail} onChange={setReturnsMail} label="Return deadline emails" />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Return deadline notifications</span>
          <Toggle checked={returnsPush} onChange={setReturnsPush} label="Return deadline notifications" />
        </label>
        <p className="-mt-1 text-xs text-muted-foreground">Sent 3 days and 1 day before an item&apos;s return window closes.</p>
        <p className="-mt-1 text-xs text-muted-foreground">Notifications only reach devices where you turned them on above.</p>
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
