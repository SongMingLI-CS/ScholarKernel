"use client"

import { memo, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type ActionTabItem = {
  id: string
  label: string
  icon?: ReactNode
  onClick?: () => void
  disabled?: boolean
  active?: boolean
}

export type ActionTabGroup = {
  id: string
  label: string
  items?: ActionTabItem[]
  panel?: ReactNode
}

type ActionTabBarProps = {
  groups: ActionTabGroup[]
  defaultGroupId?: string
  className?: string
  size?: "sm" | "xs"
  /** 仅一个分组时隐藏顶部分类 Tab */
  hideGroupTabsWhenSingle?: boolean
}

export const ActionTabBar = memo(function ActionTabBar({
  groups,
  defaultGroupId,
  className,
  size = "sm",
  hideGroupTabsWhenSingle = true,
}: ActionTabBarProps) {
  const [activeGroupId, setActiveGroupId] = useState(defaultGroupId ?? groups[0]?.id ?? "")
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0]
  const showGroupTabs = !(hideGroupTabsWhenSingle && groups.length <= 1)

  const btnClass =
    size === "xs"
      ? "h-7 gap-1 rounded-sm border-border/60 bg-background/40 px-2 font-mono text-[10px]"
      : "gap-1.5 rounded-sm border-border/60 bg-background/40 font-mono text-[11px]"

  if (!activeGroup) return null

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {showGroupTabs ? (
        <div
          className="inline-flex w-fit max-w-full overflow-x-auto sk-scrollbar rounded-sm border border-border/60 bg-background/30 p-0.5"
          role="tablist"
          aria-label="Action categories"
        >
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={g.id === activeGroupId}
              className={cn(
                "shrink-0 rounded-[3px] px-2.5 py-1 font-mono text-[10px] tracking-wide transition-colors",
                g.id === activeGroupId
                  ? "bg-sidebar-primary/15 text-foreground shadow-[inset_0_0_0_1px_oklch(0.488_0.243_264.376/0.18)]"
                  : "text-muted-foreground hover:bg-muted/20 hover:text-foreground/90"
              )}
              onClick={() => setActiveGroupId(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="min-w-0" role="tabpanel">
        {activeGroup.panel ? (
          activeGroup.panel
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {(activeGroup.items ?? []).map((item) => (
              <Button
                key={item.id}
                type="button"
                variant="outline"
                size="sm"
                className={cn(
                  btnClass,
                  item.active && "border-sidebar-primary/45 bg-sidebar-primary/10 text-foreground"
                )}
                onClick={item.onClick}
                disabled={item.disabled}
              >
                {item.icon}
                {item.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})
