"use client"

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

export function BottomSheet({
  open, onOpenChange, icon, iconClass, title, description, children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  icon?: React.ReactNode
  iconClass?: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92dvh] w-full max-w-lg gap-0 rounded-t-3xl border-0 bg-background p-0"
      >
        <div className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/25" />
        <div className="flex items-start gap-3 border-b px-5 pt-4 pb-4 pr-12">
          {icon && (
            <div className={cn("grid size-11 shrink-0 place-items-center rounded-2xl", iconClass)}>{icon}</div>
          )}
          <div className="min-w-0">
            <SheetTitle className="text-xl font-bold">{title}</SheetTitle>
            {description && <SheetDescription>{description}</SheetDescription>}
          </div>
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}
