import { cn } from "@/lib/utils"

export function StatCard({
  label, value, sub, icon, tone = "default", className,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  icon?: React.ReactNode
  tone?: "default" | "profit" | "brand" | "blue"
  className?: string
}) {
  return (
    <div className={cn("min-w-0 rounded-3xl border bg-card p-4 shadow-sm", className)}>
      <p
        className={cn(
          "flex items-center gap-1.5 text-[11px] font-bold tracking-wide uppercase",
          tone === "profit" && "text-profit",
          tone === "brand" && "text-brand",
          tone === "blue" && "text-blue-600",
          tone === "default" && "text-muted-foreground",
        )}
      >
        {icon}
        <span className="min-w-0 truncate">{label}</span>
      </p>
      <p className="mt-1.5 truncate font-mono text-2xl font-bold tracking-tight">{value}</p>
      {sub && <p className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground">{sub}</p>}
    </div>
  )
}
