"use client"

import { memo, useMemo } from "react"

import { AcademicMarkdown } from "@/components/academic-markdown"
import { CanvasChatPlaceholderCard } from "@/components/canvas-chat-placeholder"
import { bubbleContentHasCanvasCard, parseBubbleContentSegments } from "@/lib/scholar-canvas"

export const AssistantBubbleContent = memo(function AssistantBubbleContent({
  content,
  className,
  fallbackPrefix,
  onViewInCanvas,
}: {
  content: string
  className?: string
  fallbackPrefix?: string
  onViewInCanvas?: () => void
}) {
  const segments = useMemo(
    () => (bubbleContentHasCanvasCard(content) ? parseBubbleContentSegments(content) : null),
    [content]
  )

  if (!segments?.length) {
    return <AcademicMarkdown content={content} className={className} fallbackPrefix={fallbackPrefix} />
  }

  return (
    <div className="space-y-3">
      {segments.map((seg, i) =>
        seg.type === "canvas-card" ? (
          <CanvasChatPlaceholderCard
            key={`canvas-card-${i}`}
            card={seg.card}
            onViewInCanvas={onViewInCanvas}
          />
        ) : (
          <AcademicMarkdown
            key={`md-${i}`}
            content={seg.text}
            className={className}
            fallbackPrefix={fallbackPrefix}
          />
        )
      )}
    </div>
  )
})
