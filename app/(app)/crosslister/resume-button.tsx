"use client"

import { useTransition } from "react"
import { toast } from "sonner"
import { resumeCrosslister } from "./actions"

export function ResumeButton() {
  const [pending, start] = useTransition()
  return (
    <button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await resumeCrosslister()
          if (res.ok) toast.success("Welcome back. Billing picks up on your next cycle.")
          else toast.error(res.error)
        })
      }
      className="flex h-11 items-center justify-center rounded-2xl bg-brand font-bold text-ink disabled:opacity-60"
    >
      {pending ? "Resuming…" : "Resume now"}
    </button>
  )
}
