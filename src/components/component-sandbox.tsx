"use client"

import { Component, type ErrorInfo, type ReactNode } from "react"
import { AlertTriangle, Zap } from "lucide-react"

import { cn } from "@/lib/utils"

type ComponentSandboxProps = {
  moduleName: string
  children: ReactNode
  className?: string
}

type SandboxState = { error: Error | null; remountKey: number }

export class ComponentSandbox extends Component<ComponentSandboxProps, SandboxState> {
  state: SandboxState = { error: null, remountKey: 0 }

  static getDerivedStateFromError(e: unknown): Partial<SandboxState> {
    return { error: e instanceof Error ? e : new Error(String(e)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ComponentSandbox:${this.props.moduleName}]`, error, info.componentStack)
  }

  private handleRecover = () => {
    this.setState((s) => ({ error: null, remountKey: s.remountKey + 1 }))
  }

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className={cn(
            "bg-red-950/20 border border-red-900/50 rounded-xl p-4 flex flex-col items-center justify-center gap-3 text-center min-h-[120px]",
            this.props.className
          )}
        >
          <AlertTriangle className="h-8 w-8 text-red-400/90" strokeWidth={1.5} aria-hidden />
          <div className="font-mono text-[13px] text-red-100/95">{this.props.moduleName}</div>
          <p className="max-w-md font-mono text-[11px] leading-relaxed text-red-200/70">
            {this.state.error.message}
          </p>
          <button
            type="button"
            onClick={this.handleRecover}
            className="relative mt-1 inline-flex items-center gap-2 rounded-lg border border-red-800/60 bg-red-950/40 px-4 py-2 font-mono text-[12px] text-red-100/95 transition-colors hover:bg-red-950/60"
          >
            <span
              className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-red-500/40 animate-pulse"
              aria-hidden
            />
            <Zap className="h-3.5 w-3.5 text-amber-400/90" aria-hidden />
            ⚡ 局部尝试重构恢复
          </button>
        </div>
      )
    }

    return (
      <div key={this.state.remountKey} className={cn("min-h-0 min-w-0", this.props.className)}>
        {this.props.children}
      </div>
    )
  }
}
