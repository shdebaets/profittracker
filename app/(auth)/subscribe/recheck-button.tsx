"use client"

import { useActionState } from "react"
import { Button } from "@/components/ui/button"
import { recheckAccess, type RecheckState } from "./actions"

export function RecheckButton() {
  const [state, action, pending] = useActionState<RecheckState>(recheckAccess, {})
  return (
    <form action={action} className="flex flex-col gap-2">
      <Button type="submit" variant="outline" className="h-12 rounded-2xl" disabled={pending}>
        {pending ? "Checking…" : "I already bought it"}
      </Button>
      {state.checked && !pending && (
        <p className="text-center text-sm text-muted-foreground">
          Whop doesn&apos;t show a FlipLedger membership on this account yet. If you just paid, wait a minute and try again.
        </p>
      )}
    </form>
  )
}
