"use client"

import { BookOpen, MessageSquarePlus, Network, Sparkles } from "lucide-react"
import { memo } from "react"

import { useT } from "@/lib/locales"
import { cn } from "@/lib/utils"

type WelcomeEmptyStateProps = {
  variant?: "sidebar" | "chat" | "canvas" | "topology"
  className?: string
}

export const WelcomeEmptyState = memo(function WelcomeEmptyState({
  variant = "chat",
  className,
}: WelcomeEmptyStateProps) {
  const t = useT()
  const compact = variant === "sidebar" || variant === "topology"

  const hintKey =
    variant === "sidebar"
      ? "empty.welcome.hint.sidebar"
      : variant === "canvas"
        ? "empty.welcome.hint.canvas"
        : variant === "topology"
          ? "empty.welcome.hint.topology"
          : "empty.welcome.hint.chat"

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-dashed border-border/70 bg-muted/10",
        compact ? "px-3 py-4" : "mx-auto max-w-lg px-6 py-10 text-center",
        className
      )}
      data-testid={`welcome-empty-${variant}`}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 opacity-40",
          "bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,oklch(0.488_0.243_264.376/0.18),transparent_55%)]"
        )}
        aria-hidden
      />
      <div className={cn("relative", compact ? "flex items-start gap-3" : "flex flex-col items-center")}>
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-lg border border-sidebar-primary/25 bg-sidebar-primary/10",
            compact ? "h-10 w-10" : "h-14 w-14"
          )}
        >
          {variant === "canvas" ? (
            <BookOpen className={cn("text-sidebar-primary", compact ? "h-4 w-4" : "h-6 w-6")} />
          ) : variant === "sidebar" ? (
            <MessageSquarePlus className={cn("text-sidebar-primary", compact ? "h-4 w-4" : "h-6 w-6")} />
          ) : variant === "topology" ? (
            <Network className={cn("text-sidebar-primary", compact ? "h-4 w-4" : "h-6 w-6")} />
          ) : (
            <Sparkles className={cn("text-sidebar-primary", compact ? "h-4 w-4" : "h-6 w-6")} />
          )}
        </div>
        <div className={cn("min-w-0", !compact && "mt-4")}>
          <h3
            className={cn(
              "font-semibold tracking-tight text-foreground",
              compact ? "font-mono text-[12px] leading-snug" : "text-base"
            )}
          >
            {t("empty.welcome.title")}
          </h3>
          <p
            className={cn(
              "mt-1.5 text-muted-foreground",
              compact ? "font-mono text-[10px] leading-relaxed" : "text-sm leading-relaxed"
            )}
          >
            {t("empty.welcome.subtitle")}
          </p>
          <p
            className={cn(
              "mt-2 text-muted-foreground/90",
              compact ? "font-mono text-[10px] leading-relaxed" : "text-xs leading-relaxed"
            )}
          >
            {t(hintKey)}
          </p>
        </div>
      </div>
    </div>
  )
})
