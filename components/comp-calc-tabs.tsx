import { Calculator, ScanBarcode } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"

/** Switch between Scan to Comp and the Profit Calculator: they share one bottom-bar tab. */
export function CompCalcTabs({ active }: { active: "comp" | "calc" }) {
  const tab = (href: string, on: boolean, icon: React.ReactNode, label: string) => (
    <Link
      href={href}
      className={cn("flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold", on ? "bg-card shadow-sm" : "text-muted-foreground")}
    >
      {icon} {label}
    </Link>
  )
  return (
    <div className="flex gap-1 rounded-2xl bg-muted p-1">
      {tab("/comp", active === "comp", <ScanBarcode className="size-4" />, "Comp it")}
      {tab("/calculator", active === "calc", <Calculator className="size-4" />, "Profit calculator")}
    </div>
  )
}
