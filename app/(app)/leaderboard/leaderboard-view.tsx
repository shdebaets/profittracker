"use client"

import { Download, Send, Trophy } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { postWinToDiscord, saveLeaderboardProfile } from "@/app/(app)/actions/leaderboard"
import { Segmented, TextInput, Toggle } from "@/components/fields"
import type { Board, MonthTotals } from "@/lib/leaderboard"
import { formatCents } from "@/lib/money"
import { cn } from "@/lib/utils"

type Row = { name: string; totals: MonthTotals; place: number; mine: boolean }
const LABEL: Record<Board, string> = { profit: "Profit", itemsSold: "Items sold", miles: "Miles" }
const show = (b: Board, t: MonthTotals) => (b === "profit" ? formatCents(t.profit) : b === "miles" ? `${t.miles} mi` : String(t.itemsSold))

export function LeaderboardView({
  boards, champs, lastMonth, me, suggestedName, canPostToDiscord,
}: {
  boards: Record<Board, Row[]>
  champs: Record<Board, string | null>
  lastMonth: string
  me: { display_name: string; opted_in: boolean } | null
  suggestedName: string
  canPostToDiscord: boolean
}) {
  const [board, setBoard] = useState<Board>("profit")
  const [name, setName] = useState(me?.display_name ?? suggestedName)
  const [optedIn, setOptedIn] = useState(me?.opted_in ?? false)
  const [pending, start] = useTransition()
  const rows = boards[board]

  return (
    <>
      <section className="flex flex-col gap-3 rounded-3xl border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-bold">Show me on the leaderboard</p>
            <p className="text-sm text-muted-foreground">Only this name and your monthly totals are shown. Off by default.</p>
          </div>
          <Toggle checked={optedIn} onChange={setOptedIn} label="Show me on the leaderboard" />
        </div>
        <div className="flex gap-2">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="Initials or a nickname" />
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await saveLeaderboardProfile({ name, optedIn })
                if (res.ok) toast.success(optedIn ? "You're on the board" : "Saved")
                else toast.error(res.error)
              })
            }
            className="shrink-0 rounded-2xl bg-ink px-4 font-bold text-white disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </section>

      <Segmented value={board} onChange={setBoard} options={(Object.keys(LABEL) as Board[]).map((b) => ({ value: b, label: LABEL[b] }))} />

      {champs[board] && (
        <p className="flex items-center gap-2 rounded-2xl bg-brand-soft px-4 py-3 text-sm">
          <Trophy className="size-4 text-brand" /> {lastMonth} champion: <b>{champs[board]}</b>
        </p>
      )}

      <div className="flex flex-col gap-2">
        {rows.length === 0 && <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">No one on the board yet this month.</p>}
        {rows.slice(0, 50).map((r) => (
          <div key={`${r.place}-${r.name}`} className={cn("flex items-center gap-3 rounded-2xl border bg-card px-4 py-3", r.mine && "border-brand bg-brand-soft")}>
            <span className={cn("w-8 font-mono font-bold", r.place <= 3 ? "text-brand" : "text-muted-foreground")}>#{r.place}</span>
            <span className="min-w-0 flex-1 truncate font-semibold">{r.name}{r.mine ? " (you)" : ""}</span>
            <span className="font-mono font-bold">{show(board, r.totals)}</span>
          </div>
        ))}
      </div>

      <section className="flex flex-col gap-3 rounded-3xl border bg-card p-5 shadow-sm">
        <p className="font-bold">Your win card</p>
        <p className="text-sm text-muted-foreground">A shareable image with your real numbers.</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/api/win-card" alt="Your win card" className="w-full rounded-2xl border" />
        <div className="grid grid-cols-2 gap-2">
          <a href="/api/win-card" download="flipledger-win.png" className="flex h-11 items-center justify-center gap-2 rounded-2xl border font-semibold">
            <Download className="size-4" /> This month
          </a>
          <a href="/api/win-card?last=1" download="flipledger-win.png" className="flex h-11 items-center justify-center gap-2 rounded-2xl border font-semibold">
            <Download className="size-4" /> {lastMonth}
          </a>
          {canPostToDiscord && (
            <button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await postWinToDiscord("this")
                  if (res.ok) toast.success("Posted to the eMoney wins channel")
                  else toast.error(res.error)
                })
              }
              className="col-span-2 flex h-11 items-center justify-center gap-2 rounded-2xl bg-brand font-bold text-ink disabled:opacity-60"
            >
              <Send className="size-4" /> Post to eMoney Discord wins
            </button>
          )}
        </div>
      </section>
    </>
  )
}
