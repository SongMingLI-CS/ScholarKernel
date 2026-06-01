"use client"

import { memo, useCallback, useEffect, useState } from "react"
import { ArrowRight, Cloud, Cpu, Sparkles, X } from "lucide-react"

import { SetupGuide } from "@/components/setup-guide"
import { Button } from "@/components/ui/button"
import {
  ONBOARDING_STORAGE_KEY,
  onboardingCompleteValue,
  providerPatchForPath,
  type OnboardingPath,
} from "@/lib/onboarding"
import { cn } from "@/lib/utils"
import { useAgentStore } from "@/store/useAgentStore"

type WizardStep = "welcome" | "path" | "setup" | "done"

function readCompleteFromBrowser(): boolean {
  if (typeof window === "undefined") return true
  return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === onboardingCompleteValue()
}

export const OnboardingWizard = memo(function OnboardingWizard({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<WizardStep>("welcome")
  const [path, setPath] = useState<OnboardingPath>("cloud")
  const setActiveProvider = useAgentStore((s) => s.actions.setActiveProvider)
  const setActivePanel = useAgentStore((s) => s.actions.setActivePanel)

  useEffect(() => {
    setOpen(!readCompleteFromBrowser())
  }, [])

  const finish = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, onboardingCompleteValue())
    }
    setOpen(false)
    setActivePanel("chat")
  }, [setActivePanel])

  const skipAll = useCallback(() => {
    finish()
  }, [finish])

  const applyPath = useCallback(
    (next: OnboardingPath) => {
      setPath(next)
      const patch = providerPatchForPath(next)
      if (patch) setActiveProvider(patch)
      setStep("setup")
    },
    [setActiveProvider]
  )

  if (!open) return <>{children}</>

  return (
    <>
      {children}
      <div className="fixed inset-0 z-[80]">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden />
        <div className="relative mx-auto flex min-h-dvh max-w-[720px] items-center px-4 py-8">
          <div
            className="w-full overflow-hidden rounded-2xl border border-border/60 bg-background/95 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sk-onboarding-title"
          >
            <div className="flex items-start justify-between border-b border-border/60 px-5 py-4">
              <div>
                <div id="sk-onboarding-title" className="font-mono text-sm font-semibold tracking-wide">
                  快速入门向导
                </div>
                <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {step === "welcome" && "欢迎使用 ScholarKernel"}
                  {step === "path" && "选择你的第一条成功路径"}
                  {step === "setup" && "连接检测与配置"}
                  {step === "done" && "准备就绪"}
                </div>
              </div>
              <Button variant="outline" size="icon-sm" onClick={skipAll} aria-label="跳过向导">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="max-h-[70dvh] overflow-y-auto px-5 py-5 sk-scrollbar">
              {step === "welcome" ? (
                <div className="space-y-4">
                  <p className="font-mono text-[13px] leading-relaxed text-foreground/90">
                    只需几步，即可完成模型连接并发送第一条学术 Agent 对话。你可以随时在侧边栏「快速入门」中重新打开详细教程。
                  </p>
                  <ul className="space-y-2 font-mono text-[12px] text-muted-foreground">
                    <li>1. 选择本地 Ollama 或云端 DeepSeek</li>
                    <li>2. 运行连接自检</li>
                    <li>3. 进入 Agent 终端开始对话</li>
                  </ul>
                </div>
              ) : null}

              {step === "path" ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  {(
                    [
                      { id: "cloud" as const, icon: Cloud, title: "云端 DeepSeek", desc: "推荐新手，需 API Key" },
                      { id: "ollama" as const, icon: Cpu, title: "本地 Ollama", desc: "离线优先，需本地服务" },
                      { id: "skip" as const, icon: Sparkles, title: "稍后配置", desc: "直接进入应用" },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => (item.id === "skip" ? finish() : applyPath(item.id))}
                      className={cn(
                        "rounded-sm border border-dashed border-border/70 p-4 text-left transition-colors",
                        "hover:border-sidebar-primary/50 hover:bg-background/60"
                      )}
                    >
                      <item.icon className="mb-2 h-5 w-5 text-sidebar-primary/80" />
                      <div className="font-mono text-[12px] font-semibold">{item.title}</div>
                      <div className="mt-1 font-mono text-[11px] text-muted-foreground">{item.desc}</div>
                    </button>
                  ))}
                </div>
              ) : null}

              {step === "setup" ? (
                <div className="space-y-4">
                  <p className="font-mono text-[12px] text-muted-foreground">
                    {path === "cloud"
                      ? "请先在「密钥 / 隐私」面板填入 DeepSeek API Key，然后运行下方连接检测。"
                      : "请确认 Ollama 已启动并允许 CORS，然后运行连接检测。"}
                  </p>
                  <SetupGuide compact />
                </div>
              ) : null}

              {step === "done" ? (
                <div className="space-y-3 font-mono text-[13px] leading-relaxed text-foreground/90">
                  <p>向导已完成。建议从 Agent 终端发送一条简单问题，例如：「用三句话解释 Transformer 的自注意力机制」。</p>
                  <p className="text-[12px] text-muted-foreground">
                    学术检索可在「密钥 / 隐私」中配置 Tavily 或 Serper Key 后启用。
                  </p>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border/60 px-5 py-4">
              <Button variant="ghost" className="font-mono text-[12px]" onClick={skipAll}>
                跳过
              </Button>
              <div className="flex gap-2">
                {step === "welcome" ? (
                  <Button className="gap-2 font-mono" onClick={() => setStep("path")}>
                    开始 <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : null}
                {step === "setup" ? (
                  <>
                    <Button variant="outline" className="font-mono" onClick={() => setActivePanel("keys")}>
                      打开密钥面板
                    </Button>
                    <Button className="gap-2 font-mono" onClick={() => setStep("done")}>
                      下一步 <ArrowRight className="h-4 w-4" />
                    </Button>
                  </>
                ) : null}
                {step === "done" ? (
                  <Button className="gap-2 font-mono" onClick={finish}>
                    进入 Agent 终端 <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
})
