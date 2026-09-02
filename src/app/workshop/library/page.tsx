import { Suspense } from "react"

import { AppShell } from "@/components/app-shell"

function AppShellFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background font-mono text-sm text-muted-foreground">
      加载我的文献库…
    </div>
  )
}

export default function LibraryPage() {
  return (
    <Suspense fallback={<AppShellFallback />}>
      <AppShell initialPanel="library" />
    </Suspense>
  )
}
