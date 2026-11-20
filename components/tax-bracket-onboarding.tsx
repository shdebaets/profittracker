"use client"

import { PiggyBank } from "lucide-react"
import Link from "next/link"
import { useState, useSyncExternalStore, useTransition } from "react"
import { toast } from "sonner"
import { saveTaxBracket } from "@/app/(app)/actions/expenses"
import { BottomSheet } from "@/components/bottom-sheet"
import { DEFAULT_TAX_BRACKET, TAX_BRACKETS, TAX_DISCLAIMER } from "@/lib/tax"
import { cn } from "@/lib/utils"

const subscribe = () => () => {}
const DISMISSED = "fl-tax-bracket-later"

function dismissedThisVisit() {
  try {
    return sessionStorage.getItem(DISMISSED) === "1"
  } catch {
    return false
  }
}

/**
 * First-run sheet: asks for the seller's tax bracket while `settings.tax_bracket_set` is false.
 * "Skip" keeps 22% and marks it set, so it never comes back. Swiping it away only hides it for this visit.
 */
export function TaxBracketOnboarding() {
  // sessionStorage only exists in the browser, so decide after mounting.
  const mounted = useSyncExternalStore(subscribe, () => true, () => false)
  const [closed, setClosed] = useState(false)
  const [picked, setPicked] = useState<number | null>(null)
  const [pending, start] = useTransition()
  const open = mounted && !closed && !dismissedThisVisit()

  const save = (b: number, msg: string) =>
    start(async () => {
      const res = await saveTaxBracket(b)
      if (!res.ok) return void toast.error(res.error)
      toast.success(msg)
      setClosed(true)
    })

  return (
    <BottomSheet
      open={open}
      onOpenChange={(o) => {
        if (o) return
        try {
          sessionStorage.setItem(DISMISSED, "1")
        } catch {}
        setClosed(true)
      }}
      icon={<PiggyBank className="size-5 text-profit" />}
      iconClass="bg-profit-soft"
      title="What's your tax bracket?"
      description="FlipLedger uses it to show what your write-offs save you and what to set aside each quarter."
    >
      <div className="grid grid-cols-4 gap-2">
        {TAX_BRACKETS.map((b) => (
          <button
            key={b}
            type="button"
            disabled={pending}
            onClick={() => setPicked(b)}
            aria-pressed={picked === b}
            className={cn(
              "h-12 rounded-2xl border font-mono font-semibold disabled:opacity-50",
              picked === b ? "border-brand bg-brand-soft" : "bg-card",
            )}
          >
            {Math.round(b * 100)}%
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Your federal income tax bracket. You can change it any time in Settings.
      </p>
      <Link
        href="/settings"
        onClick={() => {
          // Hide it for this visit so it doesn't sit over the Settings form.
          try {
            sessionStorage.setItem(DISMISSED, "1")
          } catch {}
          setClosed(true)
        }}
        className="mt-2 block text-sm font-semibold text-brand">
        Not sure? Work it out from your income
      </Link>
      <button
        type="button"
        disabled={pending || picked === null}
        onClick={() => picked !== null && save(picked, `Tax bracket set to ${Math.round(picked * 100)}%`)}
        className="mt-4 h-12 w-full rounded-2xl bg-brand font-bold text-ink disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => save(DEFAULT_TAX_BRACKET, "Using 22%. Change it any time in Settings.")}
        className="mt-1 h-11 w-full text-sm font-semibold text-muted-foreground"
      >
        Skip, use 22%
      </button>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">{TAX_DISCLAIMER}</p>
    </BottomSheet>
  )
}
