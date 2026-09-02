import type { ReactNode } from "react"

export default function ShareLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen overflow-y-auto bg-[oklch(0.13_0.01_260)] text-foreground">
      {children}
    </div>
  )
}
