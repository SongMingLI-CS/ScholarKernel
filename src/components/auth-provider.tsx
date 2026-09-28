"use client"

import { appPath } from "@/lib/app-path"
import { SessionProvider } from "next-auth/react"

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider basePath={appPath("/api/auth")}>{children}</SessionProvider>
}
