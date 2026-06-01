import type { AcademicSearchHit } from "@/lib/tools/search-tool"
import type { ChatHistoryEntry, ActiveProviderConfig, WorkflowNode } from "@/lib/agent/planner"

export type { ChatHistoryEntry } from "@/lib/agent/planner"

export type LlmHistoryMessage = {
  role: "user" | "assistant"
  content: string
}

export type AgentExecutorDeps = {
  activeProvider: ActiveProviderConfig
  getChatHistory?: () => ChatHistoryEntry[]
  runtimeKeys?: {
    openai?: string
    anthropic?: string
    google?: string
    deepseek?: string
    tavily?: string
    serper?: string
  }
  getRuntimeKeys?: () => AgentExecutorDeps["runtimeKeys"] | null | undefined
  search?: { tavilyApiKey?: string; serperApiKey?: string }
  inference?: { temperature?: number; maxTokens?: number; contextLimit?: number }
  sourceApiBase?: string
  signal?: AbortSignal
}

export type AgentExecutorHooks = {
  onWorkflowPlanned?: (nodes: WorkflowNode[]) => void
  onNodePatch?: (id: string, patch: Partial<WorkflowNode>) => void
  onNodeLog?: (id: string, line: string) => void
  onPlanHttpError?: (message: string) => void
  onDirectChatStart?: () => void
  onDirectChatStream?: (accumulated: string) => void
  onStreamFlush?: (ctx: { nodeId?: string; reason: "pre-reasoning-stream" | "stream-finished" | "stream-error" }) => void
  onResearchResultsSynced?: (ctx: {
    nodeId: string
    sources: AcademicSearchHit[]
    citationsMarkdown: string
  }) => void
}

export type SubtaskResult = {
  id: string
  ok: boolean
  summary: string
  output?: unknown
}
