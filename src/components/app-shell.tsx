"use client"

import { memo, useEffect } from "react"
import { AnimatePresence, motion } from "framer-motion"

import { LoginGate } from "@/components/login-gate"
import { ChatPanel } from "@/components/chat-panel"
import { CorsHelpDialog } from "@/components/cors-help-dialog"
import { DashboardPanel } from "@/components/dashboard-panel"
import { KeysPanel } from "@/components/keys-panel"
import { ModelsPanel } from "@/components/models-panel"
import { SettingsPanel } from "@/components/settings-panel"
import { Sidebar } from "@/components/sidebar"
import { ToastHost } from "@/components/toast-host"
import { cn } from "@/lib/utils"
import { useAgentStore, type PanelId } from "@/store/useAgentStore"

function PanelBody({ panel }: { panel: PanelId }) {
  switch (panel) {
    case "dashboard":
      return <DashboardPanel />
    case "chat":
      return <ChatPanel />
    case "keys":
      return <KeysPanel />
    case "models":
      return <ModelsPanel />
    case "settings":
      return <SettingsPanel />
    default:
      return <DashboardPanel />
  }
}

export const AppShell = memo(function AppShell() {
  const active = useAgentStore((s) => s.ui.activePanel)
  const heartbeat = useAgentStore((s) => s.actions.heartbeatSessionKeys)

  useEffect(() => {
    heartbeat()
    const id = window.setInterval(() => heartbeat(), 30 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [heartbeat])

  return (
    <LoginGate>
      <div className="relative h-screen w-full overflow-hidden bg-background text-foreground">
      <div className="sk-grid-overlay pointer-events-none fixed inset-0 z-0" aria-hidden />
      <div className="sk-vignette pointer-events-none fixed inset-0 z-0" aria-hidden />
      <div className="relative z-[1] flex h-screen w-full overflow-hidden bg-background">
        <aside className="flex h-full w-[360px] shrink-0 flex-col overflow-hidden border-border/60 bg-sidebar text-sidebar-foreground lg:border-r">
          <div className="min-h-0 flex-1 overflow-y-auto sk-scrollbar-hide">
            <Sidebar />
          </div>
        </aside>
        <main className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              // SSR/hydration-safe: avoid leaving main panel at opacity:0 if client JS is delayed.
              initial={false}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className={cn("flex h-full min-h-0 flex-col", active === "chat" ? "overflow-hidden" : "overflow-y-auto sk-scrollbar")}
            >
              <PanelBody panel={active} />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <CorsHelpDialog />
      <ToastHost />
    </div>
    </LoginGate>
  )
})
