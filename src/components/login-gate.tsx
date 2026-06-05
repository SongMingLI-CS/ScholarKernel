"use client"

import { memo, useCallback, useEffect, useState } from "react"
import { Lock } from "lucide-react"

import { Button } from "@/components/ui/button"

type SessionState =
  | { status: "loading" }
  | { status: "open" }
  | { status: "locked"; authEnabled: true }
  | { status: "error"; message: string }

export const LoginGate = memo(function LoginGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionState>({ status: "loading" })
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshSession = useCallback(async () => {
    setSession({ status: "loading" })
    try {
      const res = await fetch("/api/auth/session", { credentials: "include", cache: "no-store" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { authEnabled?: boolean; authenticated?: boolean }
      if (!data.authEnabled || data.authenticated) {
        setSession({ status: "open" })
        return
      }
      setSession({ status: "locked", authEnabled: true })
    } catch (e) {
      setSession({ status: "error", message: e instanceof Error ? e.message : "SessionCheckFailed" })
    }
  }, [])

  useEffect(() => {
    void refreshSession()
  }, [refreshSession])

  useEffect(() => {
    const onExpired = () => {
      void refreshSession()
    }
    window.addEventListener("sk:session-expired", onExpired)
    return () => window.removeEventListener("sk:session-expired", onExpired)
  }, [refreshSession])

  const onLogin = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      setPassword("")
      await refreshSession()
    } catch (e) {
      setError(e instanceof Error ? e.message : "LoginFailed")
    } finally {
      setBusy(false)
    }
  }, [password, refreshSession])

  if (session.status === "loading") {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background font-mono text-sm text-muted-foreground">
        验证会话…
      </div>
    )
  }

  if (session.status === "error") {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-sm border border-dashed border-border/70 p-6 text-center">
          <div className="font-mono text-sm text-rose-300">无法验证登录状态：{session.message}</div>
          <Button className="mt-4" variant="outline" onClick={() => void refreshSession()}>
            重试
          </Button>
        </div>
      </div>
    )
  }

  if (session.status === "locked") {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-sm border border-dashed border-border/70 bg-background/80 p-6 shadow-lg">
          <div className="flex items-center gap-2 font-mono text-sm font-semibold tracking-wide">
            <Lock className="h-4 w-4 text-sidebar-primary" />
            ScholarKernel 登录
          </div>
          <p className="mt-2 font-mono text-[12px] leading-relaxed text-muted-foreground">
            此实例已启用访问密码。请输入管理员密码以继续使用云端会话与设置同步。
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onLogin()
            }}
            className="mt-4 w-full rounded-sm border border-border/60 bg-background/40 px-3 py-2 font-mono text-sm outline-none focus:border-sidebar-primary/60"
            placeholder="访问密码"
            autoComplete="current-password"
          />
          {error ? <div className="mt-2 font-mono text-[11px] text-rose-300">{error}</div> : null}
          <Button className="mt-4 w-full" disabled={busy || !password.trim()} onClick={() => void onLogin()}>
            {busy ? "登录中…" : "登录"}
          </Button>
        </div>
      </div>
    )
  }

  return <>{children}</>
})
