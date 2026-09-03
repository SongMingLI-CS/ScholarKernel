import type { HumanInterventionDecision, InterventionPendingEvent } from "@/lib/agent/human-intervention-gate"
import type { RecordTokenUsageInput } from "@/lib/billing/token-usage-bridge"
import type { PeerReviewCheckpointData } from "@/lib/agent/peer-review-checkpoint"
import type { NodeSnapshotRecord } from "@/lib/agent/node-resume"
import type { AcademicSearchHit } from "@/lib/tools/search-tool"
import type { EvidenceStatus } from "@/lib/evidence-status"
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
  /** 断点续跑：仅重试该节点及其后续依赖 */
  targetNodeId?: string
  /** 已完成节点的 DB/内存快照 */
  resumeSnapshots?: NodeSnapshotRecord[]
  /** 跳过 plan 阶段，直接使用已有拓扑 */
  resumeNodes?: WorkflowNode[]
  /** 节点 done 时异步持久化快照 */
  onNodeSnapshotPersist?: (record: NodeSnapshotRecord) => void | Promise<void>
  /** 跨会话文献库勾选 ID，由 Agent 调度器注入工作流上下文 */
  documentIds?: string[]
  /** 服务端解析文献库正文；浏览器端由 deps 预注入 libraryContext */
  libraryContext?: string
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
  onEvidenceStatus?: (statuses: EvidenceStatus[]) => void
  onUsage?: (usage: {
    model: string
    inputTokens: number
    outputTokens: number
    ttftMs?: number | null
  }) => void
}

export type SubtaskResult = {
  id: string
  ok: boolean
  summary: string
  output?: unknown
}
