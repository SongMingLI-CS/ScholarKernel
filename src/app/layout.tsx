import type { Metadata } from "next"
import type { ReactNode } from "react"

import "./globals.css"
import "katex/dist/katex.min.css"

export const metadata: Metadata = {
  title: "ScholarKernel-Agent",
  description: "Privacy-first, edge-cloud collaborative productivity terminal.",
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning={true}>
      <body className="h-screen overflow-hidden bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  )
}
