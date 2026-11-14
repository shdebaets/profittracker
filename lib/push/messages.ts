// Push notification copy. Pure.
import { formatCents } from "@/lib/money"

export function recapPush(n: { profit: number; itemsSold: number; miles: number; mileageWriteOff: number }) {
  const miles = n.miles > 0 ? `, ${Math.round(n.miles * 10) / 10} mi logged (${formatCents(n.mileageWriteOff)} write-off)` : ""
  return {
    title: "Your week on FlipLedger",
    body: `This week: ${formatCents(n.profit)} profit, ${n.itemsSold} ${n.itemsSold === 1 ? "item" : "items"} sold${miles}.`,
    url: "/recap",
    tag: "recap",
  }
}

export function tripPush(miles: number, deductionCents: number) {
  return {
    title: "Trip logged",
    body: `${Math.round(miles * 10) / 10} mi logged, ${formatCents(deductionCents)} write-off.`,
    url: "/expenses",
    tag: "trip",
  }
}
