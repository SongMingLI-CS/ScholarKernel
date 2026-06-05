"use client"

import { memo } from "react"

import { useT } from "@/lib/locales"
import { cn } from "@/lib/utils"

const BAR_WIDTHS = ["w-full", "w-[88%]", "w-[62%]"] as const

export const AcademicThinkingSkeleton = memo(function AcademicThinkingSkeleton({
  className,
}: {
  className?: string
}) {
  const t = useT()

  return (
    <div
      className={cn("space-y-2.5 py-0.5", className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <p className="font-mono text-[11px] tracking-wide text-muted-foreground/90">{t("chat.academicThinking")}</p>
      <div className="space-y-2" aria-hidden>
        {BAR_WIDTHS.map((width, i) => (
          <div
            key={i}
            className={cn("h-2.5 animate-pulse rounded bg-gray-700/50", width)}
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
    </div>
  )
})
