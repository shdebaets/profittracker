// Return-deadline reminders: unsold items whose return window closes in 3 days or 1 day. Pure.
import { daysUntil } from "@/lib/dates"
import type { Item } from "@/lib/types"

/** Days before the deadline a reminder goes out. */
export const REMIND_DAYS = [3, 1] as const

export type ReturnDue = { title: string; deadline: string; daysLeft: number; units: number }

/**
 * What's due for a reminder today, soonest first. A partial sale splits an item into rows with the same
 * title and deadline, so those are merged into one line.
 */
export function returnsDue(items: Pick<Item, "status" | "returnable" | "return_deadline" | "title" | "seq" | "quantity">[], now = new Date()): ReturnDue[] {
  const byKey = new Map<string, ReturnDue>()
  for (const i of items) {
    if (i.status !== "inventory" || !i.returnable || !i.return_deadline) continue
    const daysLeft = daysUntil(i.return_deadline, now)
    if (!(REMIND_DAYS as readonly number[]).includes(daysLeft)) continue
    const title = i.title?.trim() || `Item #${i.seq}`
    const key = `${title.toLowerCase()}|${i.return_deadline}`
    const prev = byKey.get(key)
    if (prev) prev.units += i.quantity
    else byKey.set(key, { title, deadline: i.return_deadline, daysLeft, units: i.quantity })
  }
  return [...byKey.values()].sort((a, b) => a.daysLeft - b.daysLeft || a.title.localeCompare(b.title))
}

export const dayWord = (d: number) => (d === 1 ? "1 day" : `${d} days`)
