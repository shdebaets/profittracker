import Link from "next/link"
import { HeaderActions } from "@/components/header-actions"
import { Logo, Wordmark } from "@/components/logo"

export function AppHeader() {
  return (
    <header className="flex items-center justify-between pt-safe">
      <Link href="/" className="flex items-center gap-2.5 pt-4">
        <Logo size={40} />
        <Wordmark height={24} heightClass="h-5 sm:h-6" />
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
        <h1 className="text-[1.7rem] leading-tight font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}
