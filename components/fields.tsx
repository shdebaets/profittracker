"use client"

import { ChevronDown, Minus, Plus } from "lucide-react"
import { cn } from "@/lib/utils"

/** Large "$ 0.00" amount entry. Value is the raw string the user typed. */
export function MoneyInput({
  value, onChange, big = false, autoFocus, id, placeholder = "0.00", className,
}: {
  value: string
  onChange: (v: string) => void
  big?: boolean
  autoFocus?: boolean
  id?: string
  placeholder?: string
  className?: string
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex items-center gap-2 rounded-2xl border bg-muted/60 px-4 transition focus-within:border-profit focus-within:bg-card focus-within:ring-2 focus-within:ring-profit/20",
        big ? "h-16" : "h-12",
        className,
      )}
    >
      <span className={cn("font-mono font-semibold text-muted-foreground", big ? "text-2xl" : "text-base")}>$</span>
      <input
        id={id}
        inputMode="decimal"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
        className={cn(
          "w-full min-w-0 bg-transparent font-mono font-semibold outline-none placeholder:text-muted-foreground/50",
          big ? "text-2xl" : "text-base",
        )}
      />
    </label>
  )
}

export function TextInput(props: React.ComponentProps<"input">) {
  return (
    <input
      {...props}
      className={cn(
        "h-12 w-full min-w-0 appearance-none rounded-2xl border bg-muted/60 px-4 text-base outline-none transition placeholder:text-muted-foreground/60 focus:border-brand focus:bg-card focus:ring-2 focus:ring-brand/20",
        props.className,
      )}
    />
  )
}

/** className sizes the wrapper (e.g. width); the select always fills it. */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      {/* Same box as TextInput so dropdowns and text fields line up. */}
      <select
        {...props}
        className="h-12 w-full min-w-0 appearance-none rounded-2xl border bg-muted/60 px-4 pr-11 text-base text-ellipsis outline-none transition focus:border-brand focus:bg-card focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
      />
      <ChevronDown className="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}

export function FieldLabel({ children, htmlFor, className }: { children: React.ReactNode; htmlFor?: string; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("mb-2 block text-sm font-semibold text-foreground/80", className)}>
      {children}
    </label>
  )
}

export function Stepper({ value, onChange, min = 1, max }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  const clamp = (n: number) => Math.max(min, max ? Math.min(max, n) : n)
  return (
    <div className="flex items-center rounded-xl border bg-card p-1">
      <button type="button" aria-label="Decrease" onClick={() => onChange(clamp(value - 1))}
        className="grid size-9 place-items-center rounded-lg active:bg-muted">
        <Minus className="size-4" />
      </button>
      <input
        inputMode="numeric"
        aria-label="Quantity"
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value.replace(/\D/g, "")) || min))}
        className="w-10 bg-transparent text-center font-mono font-semibold outline-none"
      />
      <button type="button" aria-label="Increase" onClick={() => onChange(clamp(value + 1))}
        className="grid size-9 place-items-center rounded-lg active:bg-muted">
        <Plus className="size-4" />
      </button>
    </div>
  )
}

export function QtyPicker({ value, onChange, max, label = "Quantity" }: { value: number; onChange: (n: number) => void; max?: number; label?: string }) {
  const chips = [1, 2, 5, 10].filter((n) => !max || n <= max)
  const chipRow = (
    <div className="flex gap-1.5">
      {chips.map((n) => (
        <button
          key={n} type="button" onClick={() => onChange(n)}
          className={cn(
            "h-9 min-w-9 rounded-lg px-2 font-mono text-sm font-semibold transition",
            value === n ? "bg-ink text-white" : "bg-muted text-muted-foreground",
          )}
        >
          {n}
        </button>
      ))}
    </div>
  )
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">{label}</p>
          <p className="text-sm text-muted-foreground">
            {value === 1 ? "Single item" : `${value} units`}{max ? ` · ${max} in stock` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Wide screens: chips sit beside the stepper, as in the reference design. */}
          <div className="hidden min-[430px]:block">{chipRow}</div>
          <Stepper value={value} onChange={onChange} max={max} />
        </div>
      </div>
      {chips.length > 1 && <div className="mt-3 min-[430px]:hidden">{chipRow}</div>}
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative h-8 w-14 shrink-0 rounded-full transition", checked ? "bg-profit" : "bg-input")}
    >
      <span className={cn("absolute top-1 left-1 size-6 rounded-full bg-white shadow transition", checked && "translate-x-6")} />
    </button>
  )
}

export function Segmented<T extends string>({
  value, onChange, options, className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: React.ReactNode }[]
  className?: string
}) {
  return (
    <div className={cn("flex gap-1 rounded-2xl bg-muted p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value} type="button" onClick={() => onChange(o.value)}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-sm font-semibold transition",
            value === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
