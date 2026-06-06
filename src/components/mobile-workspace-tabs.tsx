"use client"

import { memo } from "react"
import { LayoutGrid, MessageSquareText, Network } from "lucide-react"

import { cn } from "@/lib/utils"

export type MobileWorkspaceTab = "chat" | "canvas" | "topology"

type TabDef = {
  id: MobileWorkspaceTab
  label: string
  icon: React.ReactNode
  visible: boolean
}

export const MobileWorkspaceTabBar = memo(function MobileWorkspaceTabBar({
  active,
  onChange,
  showCanvas,
  showTopology,
}: {
  active: MobileWorkspaceTab
  onChange: (tab: MobileWorkspaceTab) => void
  showCanvas: boolean
  showTopology: boolean
}) {
  const tabs: TabDef[] = [
    { id: "chat", label: "对话", icon: <MessageSquareText className="h-3.5 w-3.5" />, visible: true },
    { id: "canvas", label: "画布", icon: <LayoutGrid className="h-3.5 w-3.5" />, visible: showCanvas },
    { id: "topology", label: "拓扑", icon: <Network className="h-3.5 w-3.5" />, visible: showTopology },
  ]

  const visibleTabs = tabs.filter((t) => t.visible)
  if (visibleTabs.length <= 1) return null

  return (
    <nav
      aria-label="Mobile workspace"
      className="shrink-0 border-b border-border/60 bg-background/90 px-3 py-2 backdrop-blur-md md:hidden"
    >
      <div className="mx-auto flex w-full max-w-[1200px] gap-1 rounded-sm border border-border/60 bg-background/40 p-0.5">
        {visibleTabs.map((tab) => {
          const isActive = active === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={cn(
                "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-2 font-mono text-[11px] transition-colors",
                isActive
                  ? "bg-sidebar-primary/15 text-foreground shadow-[inset_0_0_0_1px_oklch(0.488_0.243_264.376/0.35)]"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
})
