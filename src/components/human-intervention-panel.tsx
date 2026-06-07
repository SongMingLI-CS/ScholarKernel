"use client"

import { memo, useCallback, useState } from "react"

import { useT } from "@/lib/locales"
import { cn } from "@/lib/utils"
import { useAgentStore } from "@/store/useAgentStore"

type HumanInterventionPanelProps = {
  nodeId: string
  reason: string
  className?: string
}

export const HumanInterventionPanel = memo(function HumanInterventionPanel({
  nodeId,
  reason,
  className,
}: HumanInterventionPanelProps) {
  const t = useT()
  const sessionId = useAgentStore((s) => s.intervention.sessionId)
  const wfNodes = useAgentStore((s) => s.workflow.nodes)
  const setWorkflowNodes = useAgentStore((s) => s.actions.setWorkflowNodes)
  const clearIntervention = useAgentStore((s) => s.actions.clearInterventionPending)
  const pushToast = useAgentStore((s) => s.actions.pushToast)

  const [instruction, setInstruction] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const submit = useCallback(
    async (action: "approve" | "redirect") => {
      if (!sessionId) {
        pushToast({ messageKey: "intervention.noSession", variant: "error", ttlMs: 4800 })
        return
      }
      if (action === "redirect" && !instruction.trim()) {
        pushToast({ messageKey: "intervention.instructionRequired", variant: "error", ttlMs: 4800 })
        return
      }

      setSubmitting(true)
      try {
        const res = await fetch("/api/agent/intervention", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            nodeId,
            action,
            instruction: action === "redirect" ? instruction.trim() : undefined,
            workflowNodes: wfNodes,
          }),
        })
        const data = (await res.json()) as {
          ok?: boolean
          prunedNodes?: typeof wfNodes | null
          error?: string
        }
        if (!res.ok) {
          throw new Error(data.error ?? "InterventionFailed")
        }
        if (data.prunedNodes?.length) {
          setWorkflowNodes(data.prunedNodes)
        }
        clearIntervention()
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e)
        pushToast({ messageKey: "intervention.failed", detail, variant: "error", ttlMs: 6200 })
      } finally {
        setSubmitting(false)
      }
    },
    [clearIntervention, instruction, nodeId, pushToast, sessionId, setWorkflowNodes, wfNodes]
  )

  return (
    <div
      className={cn(
        "absolute bottom-full left-1/2 z-20 mb-2 w-[min(280px,calc(100vw-2rem))] -translate-x-1/2",
        "rounded-md border border-amber-500/60 bg-background/95 p-3 shadow-lg backdrop-blur-sm",
        "animate-in fade-in slide-in-from-bottom-2 duration-300",
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-400">
        {t("intervention.panelTitle")}
      </div>
      <p className="mb-2 text-[11px] leading-snug text-muted-foreground">{reason}</p>
      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder={t("intervention.placeholder")}
        rows={3}
        className="mb-2 w-full resize-none rounded-sm border border-border/70 bg-muted/20 px-2 py-1.5 font-mono text-[11px] leading-snug outline-none focus:border-amber-500/50"
        disabled={submitting}
      />
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          disabled={submitting}
          onClick={() => void submit("approve")}
          className="rounded-sm border border-emerald-500/50 bg-emerald-500/15 px-2 py-1.5 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-500/25 disabled:opacity-50"
        >
          {t("intervention.approve")}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => void submit("redirect")}
          className="rounded-sm border border-amber-500/50 bg-amber-500/15 px-2 py-1.5 text-[11px] font-semibold text-amber-100 transition hover:bg-amber-500/25 disabled:opacity-50"
        >
          {t("intervention.redirect")}
        </button>
      </div>
    </div>
  )
})
