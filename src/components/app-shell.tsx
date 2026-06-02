"use client"

import { memo, useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Menu } from "lucide-react"

import { AuthProvider } from "@/components/auth-provider"
import { LoginGate } from "@/components/login-gate"
import { OnboardingWizard } from "@/components/onboarding-wizard"
import { ChatPanel } from "@/components/chat-panel"
import { CorsHelpDialog } from "@/components/cors-help-dialog"
import { DashboardPanel } from "@/components/dashboard-panel"
import { KeysPanel } from "@/components/keys-panel"
import { ModelsPanel } from "@/components/models-panel"
import { SettingsPanel } from "@/components/settings-panel"
import { Sidebar } from "@/components/sidebar"
import { ToastHost } from "@/components/toast-host"
import { Button } from "@/components/ui/button"
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    heartbeat()
    const id = window.setInterval(() => heartbeat(), 30 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [heartbeat])

  return (
    <AuthProvider>
    <LoginGate>
      <OnboardingWizard>
      <div className="relative h-screen w-full overflow-hidden bg-background text-foreground">
      <div className="sk-grid-overlay pointer-events-none fixed inset-0 z-0" aria-hidden />
      <div className="sk-vignette pointer-events-none fixed inset-0 z-0" aria-hidden />
      <div className="relative z-[1] flex h-screen w-full overflow-hidden bg-background">
        {mobileNavOpen ? (
          <button
            type="button"
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          />
        ) : null}
        <aside
          className={cn(
            "flex h-full w-[min(360px,100vw)] shrink-0 flex-col overflow-hidden border-border/60 bg-sidebar text-sidebar-foreground",
            "fixed inset-y-0 left-0 z-40 transition-transform duration-200 ease-out lg:relative lg:translate-x-0 lg:border-r",
            mobileNavOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          )}
        >
          <div className="min-h-0 flex-1 overflow-y-auto sk-scrollbar-hide">
            <Sidebar onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </aside>
        <main className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
          <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2 lg:hidden">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Open navigation"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <span className="font-mono text-xs text-muted-foreground">ScholarKernel</span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={false}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className={cn("flex min-h-0 flex-1 flex-col", active === "chat" ? "overflow-hidden" : "overflow-y-auto sk-scrollbar")}
            >
              <PanelBody panel={active} />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <CorsHelpDialog />
      <ToastHost />
    </div>
      </OnboardingWizard>
    </LoginGate>
    </AuthProvider>
  )
})
