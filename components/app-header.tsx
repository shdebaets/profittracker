import Link from "next/link"
import { HeaderActions } from "@/components/header-actions"
import { Logo } from "@/components/logo"

export function AppHeader() {
  return (
    <header className="flex items-center justify-between pt-safe">
      <Link href="/" className="flex items-center gap-2.5 pt-4">
        <Logo size={40} />
        <span className="text-xl font-bold tracking-tight">
          Flip<span className="text-brand">Ledger</span>
        </span>
      </Link>
      <div className="pt-4">
        <HeaderActions />
      </div>
    </header>
  )
}

export function PageTitle({ title, subtitle, children }: { title: React.ReactNode; subtitle?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[1.7rem] leading-tight font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}
