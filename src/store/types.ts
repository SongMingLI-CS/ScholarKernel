import type { EvidenceStatus } from "@/lib/evidence-status"

export type PanelId = "dashboard" | "chat" | "workshop" | "library" | "keys" | "models" | "settings"

export type ProviderId =
  | "ollama"
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek_openai_compat"

export type Health = "unknown" | "ok" | "down"

export type ProbeId = "ollama"

export type ThemeMode = "dark" | "light"
export type Lang = "zh" | "en"

export type ConnectionHealth = "unknown" | "online" | "offline"

export type ProbeState = {
  health: Health
  latencyMs: number | null
  lastCheckedAt: number | null
}

export type ModelConnectivity = {
  health: ConnectionHealth
  latencyMs: number | null
  lastCheckedAt: number | null
  errorCode?: number | string
}

export type AgentSettings = {
  theme: ThemeMode
  lang: Lang
  inference: { temperature: number; maxTokens: number; contextLimit: number }
  behavior: {
    autoSearch: boolean
    maxRetries: number
    planningDepth: "conservative" | "balanced" | "creative"
    /** 纯本地模式：强制 Ollama，禁用云端检索 */
    localOnly: boolean
  }
  ui: { compactMode: boolean; showThinking: boolean }
}

export type ProviderConfig = {
  providerId: ProviderId
  model: string
  baseUrl?: string
}

export type KeyStatus = {
  hasMasterPassword: boolean
  hasEncryptedKeys: boolean
  unlocked: boolean
  configured: Record<RuntimeKeyField, boolean>
}

export type RuntimeKeyField = "openai" | "anthropic" | "google" | "deepseek" | "tavily" | "serper"

export type RuntimeKeys = Record<RuntimeKeyField, string>

export type TopologyState = {
  version: number
  nodes: Array<{
    id: string
    label: string
    status: "idle" | "running" | "done" | "error"
  }>
  edges: Array<{ id: string; source: string; target: string }>
}

export type WorkflowNodeStatus = "pending" | "running" | "done" | "error" | "pending_approval"
export type WorkflowNodeType = "read_file" | "reasoning" | "audit" | "research" | "peer_review"
export type WorkflowNodeProvider = "local" | "cloud"

export type WorkflowNode = {
  id: string
  type: WorkflowNodeType
  provider: WorkflowNodeProvider
  status: WorkflowNodeStatus
  title?: string
  logs: string[]
  output?: unknown
  metadata?: Record<string, unknown>
  error?: string
}

export type ChatMessage = {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  sources?: Array<{ title: string; url: string; snippet?: string; publishedAt?: string; source_id?: string }>
  evidenceStatuses?: EvidenceStatus[]
  /** Green badge when BibTeX/RIS references are loaded into session context */
  citationBadge?: { count: number }
}

export type InferenceMetrics = {
  at: number
  providerId: ProviderId
  model: string
  baseUrl?: string
  ttftMs: number | null
  totalMs: number
  chars: number
  inputTokens?: number
  outputTokens?: number
  ok: boolean
  error?: string
}

export type StreamingInferenceMetrics = {
  active: boolean
  runId: string
  assistantMessageId?: string
  startedAt: number
  providerId: ProviderId
  model: string
  baseUrl?: string
  directChat?: boolean
  firstTokenAt: number | null
  lastTickAt: number
  chars: number
  inputTokens?: number
  outputTokens?: number
  ttftMs: number | null
  totalMs: number
}

export type StartInferenceStreamInput = {
  runId: string
  assistantMessageId?: string
  startedAt: number
  providerId: ProviderId
  model: string
  baseUrl?: string
}

export type CorsHelpState =
  | { open: false }
  | {
      open: true
      title: string
      providerId: ProviderId
      baseUrl?: string
      detail: string
      hints: readonly string[]
    }

export type ToastVariant = "info" | "error" | "success" | "warning"
export type ToastState =
  | { open: false }
  | {
      open: true
      id: string
      messageKey: import("@/lib/locales").LocaleKey
      detail?: string
      variant: ToastVariant
      shownAt: number
      ttlMs: number
    }
