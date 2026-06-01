"use client"

/** 延迟加载 agent-executor，减小首屏 bundle */
export async function loadAgentExecutor() {
  return import("@/lib/agent-executor")
}
