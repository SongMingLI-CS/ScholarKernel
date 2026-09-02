"use client"

import { memo, useCallback } from "react"

import { CITATION_ANCHOR_CLASS } from "@/lib/page-citation"
import { cn } from "@/lib/utils"
import { useAgentStore } from "@/store/useAgentStore"

export const CitationAnchor = memo(function CitationAnchor({
  page,
  label,
  className,
}: {
  page: number
  label: string
  className?: string
}) {
  const scrollToPdfPage = useAgentStore((s) => s.actions.scrollToPdfPage)

  const onActivate = useCallback(() => {
    scrollToPdfPage(page)
  }, [page, scrollToPdfPage])

  return (
    <button
      type="button"
      data-page={page}
      data-sk-citation="page"
      className={cn(CITATION_ANCHOR_CLASS, "inline border-0 bg-transparent font-inherit leading-inherit", className)}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onActivate()
        }
      }}
    >
      {label}
    </button>
  )
})
