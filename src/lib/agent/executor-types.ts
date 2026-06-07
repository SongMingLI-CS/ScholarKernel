import type { HumanInterventionDecision, InterventionPendingEvent } from "@/lib/agent/human-intervention-gate"
import type { RecordTokenUsageInput } from "@/lib/billing/token-usage-bridge"
import type { PeerReviewCheckpointData } from "@/lib/agent/peer-review-checkpoint"
import type { AcademicSearchHit } from "@/lib/tools/search-tool"
import type { ChatHistoryEntry, ActiveProviderConfig, WorkflowNode } from "@/lib/agent/planner"

export type { HumanInterventionDecision, InterventionPendingEvent }

export type { ChatHistoryEntry } from "@/lib/agent/planner"

export type LlmHistoryMessage = {
  role: "user" | "assistant"
  content: string
}

export type NodeProgressKind = "stream_delta" | "stream_complete" | "status_line"

export type NodeProgressPayload = {
  nodeId: string
  streamId: string
  kind: NodeProgressKind
  text?: string
  delta?: string
  line?: string
}

export type PeerReviewStreamProgress = {
  streamId: string
  text: string
  delta?: string
}

export type AgentExecutorDeps = {
  activeProvider: ActiveProviderConfig
  userId?: string
  jobId?: string
  /** 异步写入 Token 审计；由 agent-server-run 注入 */
  recordTokenUsage?: (input: RecordTokenUsageInput) => void
  /** 人类介入会话键（客户端 runId 或服务端 jobId） */
  interventionSessionId?: string
  peerReviewCheckpoint?: PeerReviewCheckpointData | null
  onPeerReviewCheckpoint?: (
    patch: Partial<PeerReviewCheckpointData> & { markComplete?: PeerReviewCheckpointData["completedStages"][number] }
  ) => void | Promise<void>
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
  localOnly?: boolean
}

export type AgentExecutorHooks = {
  onWorkflowPlanned?: (nodes: WorkflowNode[]) => void
  onWorkflowTopologyPruned?: (nodes: WorkflowNode[]) => void
  onInterventionPending?: (event: InterventionPendingEvent) => void
  onNodePatch?: (id: string, patch: Partial<WorkflowNode>) => void
  onNodeLog?: (id: string, line: string) => void
  onProgress?: (payload: NodeProgressPayload) => void
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
