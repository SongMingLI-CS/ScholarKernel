import { Suspense } from "react"

import { AppShell } from "@/components/app-shell"

function AppShellFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background font-mono text-sm text-muted-foreground">
      加载 ScholarKernel…
    </div>
  )
}

export default function HomePage() {
  return (
    <Suspense fallback={<AppShellFallback />}>
      <AppShell />
    </Suspense>
  )
}
