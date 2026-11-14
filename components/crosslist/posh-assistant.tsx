"use client"

import { Loader2, Play, TriangleAlert } from "lucide-react"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { FieldLabel, MoneyInput, TextInput, Toggle } from "@/components/fields"
import {
  POSH_DEFAULTS, POSH_MAX_OFFERS, POSH_MAX_SHARES, extensionCanPoshAssist, parsePoshSettings, poshSettingsRaw, poshTasks,
  poshUsername, runPoshAssistant, setPoshSettings, useExtension, type PoshSettings, type PoshSummary,
} from "@/lib/extension"
import { marketplace } from "@/lib/marketplaces/registry"
import { centsToInput, toCents } from "@/lib/money"
import { cn } from "@/lib/utils"

const noSubscribe = () => () => {}

/**
 * Settings → Poshmark Assistant: opt-in sharing and Offer to Likers that the Chrome extension
 * runs in the seller's own Poshmark tab. Everything is per computer (this browser's storage).
 */
export function PoshAssistant() {
  // Storage only exists in the browser: render the defaults on the server, then the saved settings.
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false)
  return <PoshForm key={String(hydrated)} initial={hydrated ? parsePoshSettings(poshSettingsRaw()) : POSH_DEFAULTS} />
}

const LABELS: Record<string, string> = { share_closet: "Closet", share_party: "Party", offer_likers: "Offers" }

function PoshForm({ initial }: { initial: PoshSettings }) {
  const ext = useExtension()
  const [s, setS] = useState(initial)
  const [username, setUsername] = useState(initial.username)
  const [percent, setPercent] = useState(String(initial.offerPercent))
  const [floor, setFloor] = useState(initial.floorCents ? centsToInput(initial.floorCents) : "")
  const [shareCap, setShareCap] = useState(String(initial.shareCap))
  const [offerCap, setOfferCap] = useState(String(initial.offerCap))
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [results, setResults] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const stopListening = useRef<(() => void) | null>(null)
  const quiet = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    stopListening.current?.()
    if (quiet.current) clearTimeout(quiet.current)
  }, [])

  const save = (patch: Partial<PoshSettings>) => {
    const next = { ...s, ...patch }
    setS(next)
    setPoshSettings(next)
  }
  const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v) : null)
  const pct = whole(percent)
  const percentOk = pct != null && pct >= 10 && pct <= 80
  const tasks = poshTasks(s)
  const supported = !!ext.info && extensionCanPoshAssist()
  const needsUsername = !poshUsername(s.username)
  const offerProblem = s.offerLikers && !percentOk ? "Set an offer from 10% to 80% off" : null
  const blocked = !supported || needsUsername || !tasks.length || !!offerProblem

  const end = () => {
    setRunning(false)
    stopListening.current?.()
    stopListening.current = null
    if (quiet.current) clearTimeout(quiet.current)
  }
  // No word from the extension for a while (the worker restarted, or the FlipLedger tab slept).
  const keepAlive = () => {
    if (quiet.current) clearTimeout(quiet.current)
    quiet.current = setTimeout(() => {
      end()
      setError("No word from the extension for 5 minutes. Check the Poshmark tab.")
    }, 5 * 60_000)
  }

  const run = () => {
    setRunning(true)
    setError(null)
    setResults([])
    setStatus("Opening your closet in a new tab…")
    keepAlive()
    const line = (kind: string, sum: PoshSummary) =>
      `${LABELS[kind] ?? kind}: ${sum.note ?? (kind === "offer_likers" ? `${sum.offered} offers sent before it stopped` : `${sum.shared} shared before it stopped`)}`
    stopListening.current = runPoshAssistant(tasks, s, (e) => {
      keepAlive()
      if (e.type === "POSH_PROGRESS") return setStatus(e.text)
      if (e.type === "POSH_DONE") {
        setResults((r) => [...r, line(e.kind, e.summary)])
        if (!e.last) return setStatus("Starting the next job…")
        end()
        setStatus(null)
        toast.success("Poshmark Assistant finished")
        return
      }
      // ERROR: the extension's own message (the app's toast shows it too).
      end()
      setStatus(null)
      if (e.kind && e.summary) setResults((r) => [...r, line(e.kind!, e.summary!)])
      setError(e.error)
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border p-4">
      <div>
        <p className="flex items-center gap-2 font-semibold">
          Poshmark Assistant
          <span className={cn("rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase", marketplace("poshmark").badge)}>Poshmark</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Shares your closet, shares to the live party, and sends Offer to Likers for you, in Chrome on this computer while its tab stays open.
        </p>
      </div>

      <div role="alert" className="flex gap-2 rounded-xl border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <p>
          <b>Your Poshmark account is at risk.</b> Poshmark&apos;s terms ban bots, and sellers have had accounts limited or banned for
          automated sharing and offers. FlipLedger waits 3 to 8 seconds between actions, stops at {POSH_MAX_SHARES} shares and{" "}
          {POSH_MAX_OFFERS} offers a day, and stops the moment Poshmark shows a captcha or a slow-down message, but it can&apos;t make this
          safe. Use it at your own risk.
        </p>
      </div>

      <div>
        <FieldLabel htmlFor="posh-username" className="mb-1 text-xs">Your Poshmark username</FieldLabel>
        <TextInput
          id="posh-username" value={username} placeholder="e.g. closetqueen" className="h-11" autoCapitalize="off" autoCorrect="off" spellCheck={false}
          onChange={(e) => {
            setUsername(e.target.value)
            save({ username: poshUsername(e.target.value) })
          }}
        />
        <p className="mt-1 text-xs text-muted-foreground">It only ever works in this closet, and you must be logged in to it in Chrome.</p>
      </div>

      <Switch
        checked={s.shareCloset} onChange={(v) => save({ shareCloset: v })}
        title="Share my closet" detail="Shares every available listing to your followers, bottom to top so your closet keeps its order."
      />
      <Switch
        checked={s.shareParty} onChange={(v) => save({ shareParty: v })}
        title="Share to the current party" detail="Shares only the listings Poshmark offers to the party that's on now. Does nothing when no party is live."
      />
      <Switch
        checked={s.offerLikers} onChange={(v) => save({ offerLikers: v })}
        title="Offer to likers" detail="Sends Offer to Likers on listings with likes, at most once a day per listing."
      />
      {s.offerLikers && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <FieldLabel htmlFor="posh-percent" className="mb-1 text-xs">Offer (% off)</FieldLabel>
            <div className="relative">
              <TextInput
                id="posh-percent" inputMode="numeric" value={percent} className="h-12 pr-7 text-right"
                onChange={(e) => {
                  setPercent(e.target.value)
                  const n = whole(e.target.value)
                  if (n != null && n >= 10 && n <= 80) save({ offerPercent: n })
                }}
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">%</span>
            </div>
          </div>
          <div>
            <FieldLabel htmlFor="posh-floor" className="mb-1 text-xs">Never offer under</FieldLabel>
            <MoneyInput
              id="posh-floor" value={floor}
              onChange={(v) => {
                setFloor(v)
                save({ floorCents: toCents(v) })
              }}
            />
          </div>
          <p className="col-span-2 text-xs text-muted-foreground">
            Rounded down to whole dollars. If {percent || "that"}% off lands under your floor, it offers the floor instead, and it skips listings where the floor
            isn&apos;t at least 10% off (Poshmark&apos;s minimum).
          </p>
          {offerProblem && <p className="col-span-2 text-xs font-semibold text-loss">{offerProblem}</p>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <CapInput
          id="posh-share-cap" label="Shares a day" max={POSH_MAX_SHARES} value={shareCap}
          onChange={(v, n) => {
            setShareCap(v)
            if (n != null) save({ shareCap: n })
          }}
        />
        <CapInput
          id="posh-offer-cap" label="Offers a day" max={POSH_MAX_OFFERS} value={offerCap}
          onChange={(v, n) => {
            setOfferCap(v)
            if (n != null) save({ offerCap: n })
          }}
        />
      </div>

      <button
        type="button" disabled={blocked || running} onClick={run}
        className="flex h-11 items-center justify-center gap-2 rounded-xl bg-brand font-bold text-ink disabled:opacity-50"
      >
        {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} {running ? "Running…" : "Run now"}
      </button>
      {!supported ? (
        <p className="text-xs text-muted-foreground">
          {ext.info ? `Update the FlipLedger extension (you have ${ext.info.version}; this needs 0.8.0 or newer).` : "Needs the FlipLedger Chrome extension on this computer."}
        </p>
      ) : needsUsername ? (
        <p className="text-xs text-muted-foreground">Add your Poshmark username to run it.</p>
      ) : !tasks.length ? (
        <p className="text-xs text-muted-foreground">Turn on at least one of the above to run it.</p>
      ) : (
        !running && <p className="text-xs text-muted-foreground">It opens your closet in a new tab. Keep that tab open until it says it&apos;s done; Stop is in its corner.</p>
      )}
      {status && <p className="text-sm" aria-live="polite">{status}</p>}
      {results.length > 0 && (
        <ul className="list-disc pl-5 text-sm">
          {results.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
      {error && <p className="rounded-xl bg-loss/10 px-3 py-2 text-sm text-loss">{error}</p>}
    </div>
  )
}

function Switch({ checked, onChange, title, detail }: { checked: boolean; onChange: (v: boolean) => void; title: string; detail: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} />
    </div>
  )
}

function CapInput({ id, label, max, value, onChange }: { id: string; label: string; max: number; value: string; onChange: (v: string, n: number | null) => void }) {
  const n = /^\d+$/.test(value.trim()) ? Number(value) : null
  const ok = n != null && n <= max
  return (
    <div>
      <FieldLabel htmlFor={id} className="mb-1 text-xs">{label} (max {max})</FieldLabel>
      <TextInput
        id={id} inputMode="numeric" value={value} className="h-11"
        onChange={(e) => {
          const v = e.target.value
          const m = /^\d+$/.test(v.trim()) ? Number(v) : null
          onChange(v, m != null && m <= max ? m : null)
        }}
      />
      {!ok && <p className="mt-1 text-xs font-semibold text-loss">Enter 0 to {max}</p>}
    </div>
  )
}
