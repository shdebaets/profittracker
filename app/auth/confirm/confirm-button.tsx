"use client"

import { useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"

export function ConfirmButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="h-12 w-full rounded-xl text-base font-semibold">
      {pending ? "Signing you in…" : "Continue"}
    </Button>
  )
}
