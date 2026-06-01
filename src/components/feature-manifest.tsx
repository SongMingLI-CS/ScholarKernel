"use client"

import { memo, useEffect } from "react"
import { motion } from "framer-motion"
import { Activity, Cpu, ShieldCheck, Workflow, X } from "lucide-react"

import { dictionary } from "@/lib/locales"
import { cn } from "@/lib/utils"
import { useAgentStore } from "@/store/useAgentStore"
import { Button } from "@/components/ui/button"

type FeatureManifestProps = {
  className?: string
}

const container = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.08,
    },
  },
} as const

const item = {
  hidden: { opacity: 0, y: 14, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
  },
} as const

function ThinkingPathSvg({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1200 520" className={className} role="img" aria-label="Agent thinking path diagram">
      <defs>
        <linearGradient id="sk-manifest-link" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.72 0.19 145 / 0.28)" />
          <stop offset="52%" stopColor="oklch(0.488 0.243 264.376 / 0.22)" />
          <stop offset="100%" stopColor="oklch(0.78 0.16 75 / 0.22)" />
        </linearGradient>
      </defs>

      <g fill="none" stroke="url(#sk-manifest-link)" strokeWidth="2">
        <path d="M80 120 C 260 40, 360 80, 520 160 S 860 240, 1120 120" />
        <path d="M120 400 C 300 320, 420 340, 560 420 S 900 520, 1120 420" />
        <path d="M120 250 C 260 210, 360 190, 520 240 S 820 320, 1120 280" />
      </g>
      <g fill="oklch(1 0 0 / 0.10)">
        <circle cx="80" cy="120" r="3" />
        <circle cx="520" cy="160" r="3" />
        <circle cx="1120" cy="120" r="3" />
        <circle cx="120" cy="400" r="3" />
        <circle cx="560" cy="420" r="3" />
        <circle cx="1120" cy="420" r="3" />
        <circle cx="120" cy="250" r="3" />
        <circle cx="520" cy="240" r="3" />
        <circle cx="1120" cy="280" r="3" />
      </g>
    </svg>
  )
}

function PulseIcon({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.span
      className={cn(
        "relative inline-flex h-10 w-10 items-center justify-center rounded-sm",
        "border border-dashed border-border/70 bg-background/40",
        className
      )}
      animate={{ boxShadow: ["0 0 0 0 oklch(0.72 0.19 145 / 0)", "0 0 0 2px oklch(0.72 0.19 145 / 0.22)", "0 0 0 0 oklch(0.72 0.19 145 / 0)"] }}
      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
    >
      {children}
    </motion.span>
  )
}

export const FeatureManifest = memo(function FeatureManifest({ className }: FeatureManifestProps) {
  const lang = useAgentStore((s) => s.settings.lang)
  const m = dictionary.manifest
  const title = m.title[lang]
  const subtitle = m.subtitle[lang]

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-sm border border-dashed border-border/70 p-5",
        "bg-zinc-50 text-foreground shadow-[inset_0_0_0_1px_oklch(0_0_0/0.03)]",
        "dark:bg-[#0a0a0a] dark:shadow-[inset_0_0_0_1px_oklch(1_0_0/0.06)]",
        className
      )}
      aria-label="System feature manifest"
    >
      {/* background layers */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 opacity-[0.65] dark:opacity-[0.22] [background-size:32px_32px] [background-image:linear-gradient(to_right,oklch(0_0_0/0.06)_1px,transparent_1px),linear-gradient(to_bottom,oklch(0_0_0/0.06)_1px,transparent_1px)] dark:[background-image:linear-gradient(to_right,oklch(1_0_0/0.06)_1px,transparent_1px),linear-gradient(to_bottom,oklch(1_0_0/0.06)_1px,transparent_1px)]" />
        <ThinkingPathSvg className="absolute inset-0 h-full w-full opacity-[0.38] dark:opacity-[0.26]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background/60 dark:to-black/55" />
      </div>

      <header className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {title}
            </div>
            <div className="mt-2 max-w-[72ch] font-mono text-[13px] leading-relaxed text-foreground/90">
              {subtitle}
            </div>
          </div>
          <div className="hidden shrink-0 font-mono text-[10px] text-muted-foreground sm:block">
            Kernel
          </div>
        </div>
      </header>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className={cn("relative mt-5 grid gap-3", "sm:grid-cols-2")}
      >
        <motion.div
          variants={item}
          className={cn(
            "rounded-sm border border-dashed border-border/70 p-4",
            "bg-background/40 dark:bg-background/20"
          )}
        >
          <div className="flex items-start gap-3">
            <PulseIcon>
              <ShieldCheck className="h-5 w-5 text-emerald-400/90 dark:text-emerald-300/90" />
            </PulseIcon>
            <div className="min-w-0">
              <div className="font-mono text-[12px] font-semibold tracking-wide text-foreground/95">{m.privacyTitle[lang]}</div>
              <div className="mt-1 font-mono text-[12px] leading-relaxed text-muted-foreground">{m.privacyDesc[lang]}</div>
            </div>
          </div>
        </motion.div>

        <motion.div
          variants={item}
          className={cn(
            "rounded-sm border border-dashed border-border/70 p-4",
            "bg-background/40 dark:bg-background/20"
          )}
        >
          <div className="flex items-start gap-3">
            <PulseIcon>
              <Cpu className="h-5 w-5 text-amber-400/90 dark:text-amber-300/90" />
            </PulseIcon>
            <div className="min-w-0">
              <div className="font-mono text-[12px] font-semibold tracking-wide text-foreground/95">{m.hybridTitle[lang]}</div>
              <div className="mt-1 font-mono text-[12px] leading-relaxed text-muted-foreground">{m.hybridDesc[lang]}</div>
            </div>
          </div>
        </motion.div>

        <motion.div
          variants={item}
          className={cn(
            "rounded-sm border border-dashed border-border/70 p-4",
            "bg-background/40 dark:bg-background/20"
          )}
        >
          <div className="flex items-start gap-3">
            <PulseIcon>
              <Workflow className="h-5 w-5 text-sky-400/90 dark:text-sky-300/90" />
            </PulseIcon>
            <div className="min-w-0">
              <div className="font-mono text-[12px] font-semibold tracking-wide text-foreground/95">{m.agentTitle[lang]}</div>
              <div className="mt-1 font-mono text-[12px] leading-relaxed text-muted-foreground">{m.agentDesc[lang]}</div>
            </div>
          </div>
        </motion.div>

        <motion.div
          variants={item}
          className={cn(
            "rounded-sm border border-dashed border-border/70 p-4",
            "bg-background/40 dark:bg-background/20"
          )}
        >
          <div className="flex items-start gap-3">
            <PulseIcon>
              <Activity className="h-5 w-5 text-violet-400/90 dark:text-violet-300/90" />
            </PulseIcon>
            <div className="min-w-0">
              <div className="font-mono text-[12px] font-semibold tracking-wide text-foreground/95">{m.auditTitle[lang]}</div>
              <div className="mt-1 font-mono text-[12px] leading-relaxed text-muted-foreground">{m.auditDesc[lang]}</div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </section>
  )
})

export function FeatureManifestDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
}) {
  const lang = useAgentStore((s) => s.settings.lang)
  const m = dictionary.manifest

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onOpenChange, open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70]">
      <button
        type="button"
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        aria-label="close"
        onClick={() => onOpenChange(false)}
      />

      <div className="relative mx-auto flex min-h-dvh max-w-[1100px] items-center px-4 py-10">
        <div
          className="w-full overflow-hidden rounded-2xl border border-border/60 bg-background/85 shadow-[0_0_0_1px_oklch(0.488_0.243_264.376/0.18),0_30px_120px_oklch(0_0_0/0.55)]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sk-manifest-title"
        >
          <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div className="min-w-0">
              <div id="sk-manifest-title" className="font-mono text-sm font-semibold tracking-wide text-foreground/95">
                {m.title[lang]}
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                {m.subtitle[lang]}
              </div>
            </div>

            <Button
              variant="outline"
              size="icon-sm"
              className="border-border/60 bg-background/30"
              onClick={() => onOpenChange(false)}
              aria-label="close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="px-5 py-5">
            <FeatureManifest />
          </div>
        </div>
      </div>
    </div>
  )
}
