"use client"

import { Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { LoginGate } from "@/components/login-gate"
import { resolveSafeCallbackPath } from "@/lib/api-fetch"

function LoginRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const target = resolveSafeCallbackPath(searchParams.get("callbackUrl"), window.location.origin)
    router.replace(target)
  }, [router, searchParams])

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background font-mono text-sm text-muted-foreground">
      登录成功，正在进入工作台…
    </div>
  )
}

function LoginPageFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background font-mono text-sm text-muted-foreground">
      加载登录页…
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginPageFallback />}>
      <LoginGate>
        <LoginRedirect />
      </LoginGate>
    </Suspense>
  )
}
