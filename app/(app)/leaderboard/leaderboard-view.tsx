"use client"

import { Award, Download, Send, Share2, Trophy } from "lucide-react"
import { useState, useSyncExternalStore, useTransition } from "react"
import { toast } from "sonner"
import { postWinToDiscord, saveLeaderboardProfile } from "@/app/(app)/actions/leaderboard"
import { Segmented, TextInput, Toggle } from "@/components/fields"
import { badgeLabel, type Badge, type Board, type MonthTotals } from "@/lib/leaderboard"
import { formatCents } from "@/lib/money"
import { cn } from "@/lib/utils"

type Row = { name: string; totals: MonthTotals; place: number; mine: boolean; badges: Badge[] }
const MEDAL = ["", "🥇", "🥈", "🥉"]

function BadgeChips({ badges }: { badges: Badge[] }) {
  if (!badges.length) return null
  return (
    <span className="flex shrink-0 gap-0.5" aria-label={badges.map(badgeLabel).join(", ")}>
      {badges.map((b) => (
        <span key={`${b.year}-${b.month}-${b.board}`} title={badgeLabel(b)} className="text-sm leading-none">{MEDAL[b.place]}</span>
      ))}
    </span>
  )
}

/** Share sheet with the PNG on phones that can share files; a download everywhere else. */
async function shareOrDownload(url: string, filename: string) {
  const blob = await fetch(url).then((r) => {
    if (!r.ok) throw new Error("card")
    return r.blob()
  })
  const file = new File([blob], filename, { type: "image/png" })
  const mobile = window.matchMedia("(pointer: coarse)").matches
  if (mobile && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "My FlipLedger win" })
      return
    } catch (e) {
      if ((e as Error).name === "AbortError") return // closed the share sheet
    }
  }
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}
const LABEL: Record<Board, string> = { profit: "Profit", itemsSold: "Items sold", miles: "Miles" }
const show = (b: Board, t: MonthTotals) => (b === "profit" ? formatCents(t.profit) : b === "miles" ? `${t.miles} mi` : String(t.itemsSold))

const canShareFiles = () => {
  try {
    const probe = new File([new Uint8Array(1)], "x.png", { type: "image/png" })
    return window.matchMedia("(pointer: coarse)").matches && !!navigator.canShare?.({ files: [probe] })
  } catch {
    return false
  }
}
const noSubscribe = () => () => {}

/** Whether this device shares the card through the share sheet (phones) rather than downloading it. */
const useCanShareFiles = () => useSyncExternalStore(noSubscribe, canShareFiles, () => false)

export function LeaderboardView({
  boards, champs, lastMonth, me, myBadges, suggestedName, canPostToDiscord,
}: {
  boards: Record<Board, Row[]>
  champs: Record<Board, string | null>
  lastMonth: string
  me: { display_name: string; opted_in: boolean } | null
  myBadges: Badge[]
  suggestedName: string
  canPostToDiscord: boolean
}) {
  const [board, setBoard] = useState<Board>("profit")
  const [name, setName] = useState(me?.display_name ?? suggestedName)
  const [optedIn, setOptedIn] = useState(me?.opted_in ?? false)
  const [pending, start] = useTransition()
  const rows = boards[board]
  const canShareFiles = useCanShareFiles()

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
            <BadgeChips badges={r.badges} />
            <span className="font-mono font-bold">{show(board, r.totals)}</span>
          </div>
        ))}
      </div>

      <section className="flex flex-col gap-3 rounded-3xl border bg-card p-5 shadow-sm">
        <p className="flex items-center gap-2 font-bold"><Award className="size-4 text-brand" /> Your badges</p>
        {myBadges.length ? (
          <div className="flex flex-wrap gap-2">
            {myBadges.map((b) => (
              <span key={`${b.year}-${b.month}-${b.board}`} className="rounded-full bg-brand-soft px-3 py-1 text-sm font-semibold">
                {MEDAL[b.place]} {badgeLabel(b)}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Finish in the top 3 on a board this month to earn one. Badges are handed out on the 1st.</p>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-3xl border bg-card p-5 shadow-sm">
        <p className="font-bold">Your win card</p>
        <p className="text-sm text-muted-foreground">A shareable image with your real numbers.</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/api/win-card" alt="Your win card" className="w-full rounded-2xl border" />
        <div className="grid grid-cols-2 gap-2">
          {([["/api/win-card", "This month"], ["/api/win-card?last=1", lastMonth]] as const).map(([url, label]) => (
            <button
              key={url}
              type="button"
              onClick={() => shareOrDownload(url, "flipledger-win.png").catch(() => toast.error("Couldn't make the card. Try again."))}
              className="flex h-11 items-center justify-center gap-2 rounded-2xl border font-semibold"
            >
              {canShareFiles ? <Share2 className="size-4" /> : <Download className="size-4" />} {label}
            </button>
          ))}
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
