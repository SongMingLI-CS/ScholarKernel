import { create } from "zustand"
import { persist, subscribeWithSelector } from "zustand/middleware"

import type { ConversationSummary } from "@/lib/db-types"
import { prismaMessageToChat } from "@/lib/db-types"
import {
  appendMessage,
  clearConversationMessages,
  createConversation as apiCreateConversation,
  deleteConversation as apiDeleteConversation,
  fetchConversation,
  fetchConversations,
  fetchSettings,
  patchConversation as apiPatchConversation,
  patchSettings,
} from "@/lib/conversation-api"

export type PanelId = "dashboard" | "chat" | "keys" | "models" | "settings"

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
  /**
   * Last known error "code" for quick UI rendering:
   * - HTTP status (e.g. 401)
   * - or a short string reason (e.g. MissingApiKey / CorsBlocked / NetworkError)
   */
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
  }
  ui: { compactMode: boolean; showThinking: boolean }
}

export type ProviderConfig = {
  providerId: ProviderId
  model: string
  baseUrl?: string
}

const PROVIDER_DEFAULTS: Record<ProviderId, Required<Pick<ProviderConfig, "model" | "baseUrl">>> = {
  ollama: { model: "llama3.1", baseUrl: "http://localhost:11434" },
  openai: { model: "gpt-4o", baseUrl: "https://api.openai.com/v1" },
  anthropic: { model: "claude-3-5-sonnet-latest", baseUrl: "https://api.anthropic.com" },
  google: { model: "gemini-2.0-flash", baseUrl: "https://generativelanguage.googleapis.com" },
  deepseek_openai_compat: { model: "deepseek-chat", baseUrl: "/api/proxy/deepseek" },
}

function normalizeProviderModel(providerId: ProviderId, model: string) {
  const m = (model ?? "").trim()
  return m || PROVIDER_DEFAULTS[providerId].model
}

function resetProviderDefaults(providerId: ProviderId): ProviderConfig {
  const d = PROVIDER_DEFAULTS[providerId]
  return { providerId, model: d.model, baseUrl: d.baseUrl }
}

export type KeyStatus = {
  hasMasterPassword: boolean
  hasEncryptedKeys: boolean
  unlocked: boolean
}

export type RuntimeKeyField = "openai" | "anthropic" | "google" | "deepseek" | "tavily" | "serper"

export type RuntimeKeys = Record<RuntimeKeyField, string>

/** 参考 Maoxuan-Changzheng：无 Key 时各字段均为 ""，绝不写入占位符 */
export const EMPTY_RUNTIME_KEYS: RuntimeKeys = {
  openai: "",
  anthropic: "",
  google: "",
  deepseek: "",
  tavily: "",
  serper: "",
}

export const RUNTIME_KEY_FIELDS = Object.keys(EMPTY_RUNTIME_KEYS) as RuntimeKeyField[]

/** Legacy session keys — cleared on cloud init (Route B) */
const SESSION_RUNTIME_KEYS = "sk:runtime-keys:session:v3"
const SESSION_RUNTIME_KEYS_LEGACY_V1 = "sk:runtime-keys:session:v1"
const SESSION_RUNTIME_KEYS_LEGACY_V2 = "sk:runtime-keys:session:v2"

function clearLegacySessionKeys() {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.removeItem(SESSION_RUNTIME_KEYS)
    window.sessionStorage.removeItem(SESSION_RUNTIME_KEYS_LEGACY_V1)
    window.sessionStorage.removeItem(SESSION_RUNTIME_KEYS_LEGACY_V2)
  } catch {
    /* ignore */
  }
}

let settingsSyncTimer: ReturnType<typeof setTimeout> | null = null
const messagePersistTimers = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleSettingsSync(patch: { theme?: ThemeMode; runtimeKeys?: Partial<RuntimeKeys> | null }) {
  if (typeof window === "undefined") return
  if (settingsSyncTimer) clearTimeout(settingsSyncTimer)
  settingsSyncTimer = setTimeout(() => {
    settingsSyncTimer = null
    void patchSettings(patch).catch((e) => console.error("[cloud settings sync]", e))
  }, 400)
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function trimKey(value: string | undefined | null) {
  return typeof value === "string" ? value.trim() : ""
}

/** 合法云厂商 / 检索 Key：非空、非 dummy / 测试占位、长度达标 */
export function isUsableApiKey(value: string | undefined | null): boolean {
  const t = trimKey(value)
  if (!t) return false
  if (t.length < 8) return false
  if (/dummy/i.test(t)) return false
  if (/^(sk|tvly)-test-/i.test(t)) return false
  return true
}

/** 载入或保存前清洗：非法字段归零为 "" */
export function sanitizeRuntimeKeys(raw: RuntimeKeys | null | undefined): RuntimeKeys | null {
  if (!raw) return null
  const out = { ...EMPTY_RUNTIME_KEYS }
  for (const field of RUNTIME_KEY_FIELDS) {
    const v = raw[field]
    out[field] = isUsableApiKey(v) ? trimKey(v) : ""
  }
  return hasAnyRuntimeKey(out) ? out : null
}

export function getRuntimeKeyForProvider(keys: RuntimeKeys | null | undefined, providerId: ProviderId): string {
  if (!keys || providerId === "ollama") return ""
  if (providerId === "openai") return trimKey(keys.openai)
  if (providerId === "deepseek_openai_compat") return trimKey(keys.deepseek)
  if (providerId === "anthropic") return trimKey(keys.anthropic)
  if (providerId === "google") return trimKey(keys.google)
  return ""
}

export function hasRuntimeKeyForProvider(keys: RuntimeKeys | null | undefined, providerId: ProviderId): boolean {
  return isUsableApiKey(getRuntimeKeyForProvider(keys, providerId))
}

/** 增量合并：仅当 incoming 字段合法时覆盖，否则保留 existing */
export function mergeRuntimeKeysUpdate(
  existing: RuntimeKeys | null | undefined,
  incoming: Partial<RuntimeKeys>
): RuntimeKeys | null {
  const prev = sanitizeRuntimeKeys(existing) ?? { ...EMPTY_RUNTIME_KEYS }
  const out = { ...EMPTY_RUNTIME_KEYS }
  for (const field of RUNTIME_KEY_FIELDS) {
    const next = incoming[field]
    if (isUsableApiKey(next)) {
      out[field] = trimKey(next)
    } else if (isUsableApiKey(prev[field])) {
      out[field] = prev[field]
    } else {
      out[field] = ""
    }
  }
  return hasAnyRuntimeKey(out) ? out : null
}

function hasAnyRuntimeKey(keys: RuntimeKeys | null): boolean {
  if (!keys) return false
  return RUNTIME_KEY_FIELDS.some((f) => isUsableApiKey(keys[f]))
}

export type TopologyState = {
  version: number
  nodes: Array<{
    id: string
    label: string
    status: "idle" | "running" | "done" | "error"
  }>
  edges: Array<{ id: string; source: string; target: string }>
}

export type WorkflowNodeStatus = "pending" | "running" | "done" | "error"
export type WorkflowNodeType = "read_file" | "reasoning" | "audit" | "research"
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
  sources?: Array<{ title: string; url: string; snippet?: string; publishedAt?: string }>
}

export type InferenceMetrics = {
  at: number
  providerId: ProviderId
  model: string
  baseUrl?: string
  ttftMs: number | null
  totalMs: number
  chars: number
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
  /** 直连对话（跳过任务规划）；用于 UI 避免误显示「等待 tokens」占位 */
  directChat?: boolean
  firstTokenAt: number | null
  lastTickAt: number
  chars: number
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

export type ToastVariant = "info" | "error" | "success"
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

type AgentStore = {
  settings: AgentSettings
  ui: {
    activePanel: PanelId
    corsHelp: CorsHelpState
    toast: ToastState
  }
  chat: {
    messages: ChatMessage[]
  }
  conversations: {
    items: ConversationSummary[]
    currentId: string | null
    loading: boolean
    cloudReady: boolean
  }
  keys: KeyStatus
  runtimeKeys: RuntimeKeys | null
  providers: {
    active: ProviderConfig
  }
  probes: Record<ProbeId, ProbeState>
  connectivity: Record<string, ModelConnectivity>
  topology: TopologyState
  workflow: {
    version: number
    activeNodeId: string | null
    /** 已成功解析并下发工作流计划（用于 UI 抑制将规划 JSON 当作普通回复展示） */
    isPlannerOutput: boolean
    nodes: WorkflowNode[]
  }
  inference: {
    streaming: StreamingInferenceMetrics | null
    last: InferenceMetrics | null
    /** 最近完成的推理记录（最多 10 条），用于看板趋势图 */
    history: InferenceMetrics[]
  }

  actions: {
    setActivePanel: (panel: PanelId) => void
    setTheme: (theme: ThemeMode) => void
    setLang: (lang: Lang) => void
    patchSettings: (patch: Partial<Omit<AgentSettings, "inference" | "behavior" | "ui">>) => void
    patchInferenceSettings: (patch: Partial<AgentSettings["inference"]>) => void
    patchBehaviorSettings: (patch: Partial<AgentSettings["behavior"]>) => void
    patchUiSettings: (patch: Partial<AgentSettings["ui"]>) => void
    clearSessionStorage: () => void
    clearAllLocalData: () => void
    importConfig: (input: { settings?: Partial<AgentSettings>; providers?: Partial<AgentStore["providers"]> }) => void
    setProbe: (id: ProbeId, patch: Partial<ProbeState>) => void
    setConnectivity: (key: string, patch: Partial<ModelConnectivity>) => void
    setActiveProvider: (patch: Partial<ProviderConfig>) => void
    resetProviderDefaults: (providerId: ProviderId) => void
    setKeyStatus: (patch: Partial<KeyStatus> | ((prev: KeyStatus) => Partial<KeyStatus>)) => void
    /** 返回当前会话明文密钥（已清洗，无占位符） */
    getRuntimeKeys: () => RuntimeKeys | null
    setRuntimeKeys: (keys: Partial<RuntimeKeys> | null) => void
    /** 云厂商 Key 是否已配置（参考 cfg.key 判空） */
    hasRuntimeKeyForProvider: (providerId: ProviderId) => boolean
    /** 401/403 时弹出可观测错误（由 ai-gateway 调用） */
    notifyAuthFailure: (detail?: string, status?: number) => void
    setTopology: (t: TopologyState) => void
    patchTopologyNodes: (patch: Partial<Record<string, TopologyState["nodes"][number]["status"]>>) => void
    setChatMessages: (messages: ChatMessage[]) => void
    pushChatMessage: (m: ChatMessage) => void
    patchChatMessage: (id: string, patch: Partial<ChatMessage>) => void
    /** Route B: bootstrap cloud settings + conversation list */
    initializeCloud: () => Promise<void>
    fetchConversationsList: () => Promise<void>
    createConversation: () => Promise<ConversationSummary>
    switchConversation: (id: string) => Promise<void>
    renameConversation: (id: string, title: string) => Promise<void>
    togglePinConversation: (id: string, isPinned: boolean) => Promise<void>
    deleteConversation: (id: string) => Promise<void>
    clearCurrentConversation: () => Promise<void>
    persistChatMessage: (m: ChatMessage) => void
    setWorkflowNodes: (nodes: WorkflowNode[]) => void
    /** 新一轮对话开始时清除「规划已下发」标记，避免沿用上一次的 isPlannerOutput */
    resetWorkflowPlanOutput: () => void
    updateNodeStatus: (id: string, status: WorkflowNodeStatus, metadata?: Record<string, unknown>) => void
    patchWorkflowNode: (id: string, patch: Partial<WorkflowNode>) => void
    appendNodeLog: (id: string, line: string) => void
    startInferenceStream: (input: StartInferenceStreamInput) => void
    patchActiveInferenceStream: (input: {
      runId: string
      patch: Partial<Pick<StreamingInferenceMetrics, "directChat">>
    }) => void
    tickInferenceStream: (input: { runId: string; now: number; charsDelta: number; firstToken: boolean }) => void
    finishInferenceStream: (input: { runId: string; now: number; ok: boolean; error?: string }) => void
    setInferenceLast: (m: InferenceMetrics | null) => void
    openCorsHelp: (input: { providerId: ProviderId; baseUrl?: string; detail: string }) => void
    closeCorsHelp: () => void
    pushToast: (input: {
      messageKey: import("@/lib/locales").LocaleKey
      detail?: string
      variant?: ToastVariant
      ttlMs?: number
    }) => void
    closeToast: () => void
    resetTopology: () => void
    heartbeatSessionKeys: () => void
  }
}

const now = () => Date.now()

function applyThemeToDom(theme: ThemeMode) {
  if (typeof document === "undefined") return
  document.documentElement.classList.toggle("dark", theme === "dark")
}

function applyCompactModeToDom(compactMode: boolean) {
  if (typeof document === "undefined") return
  document.documentElement.classList.toggle("sk-compact", compactMode)
}

const initialTopology: TopologyState = {
  version: 1,
  nodes: [
    { id: "edge", label: "Browser", status: "idle" },
    { id: "route", label: "Router", status: "idle" },
    { id: "cloud", label: "Cloud / Local Runtime", status: "idle" },
    { id: "sink", label: "Stream Merge", status: "idle" },
  ],
  edges: [
    { id: "e-edge-route", source: "edge", target: "route" },
    { id: "e-route-cloud", source: "route", target: "cloud" },
    { id: "e-cloud-sink", source: "cloud", target: "sink" },
  ],
}

function randomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeBaseUrl(baseUrl?: string) {
  if (!baseUrl) return ""
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl
}

export function buildTopologyForActiveProvider(active: ProviderConfig): TopologyState {
  const v = Date.now()
  const base = normalizeBaseUrl(active.baseUrl)

  const mk = (nodes: TopologyState["nodes"], edges: TopologyState["edges"]): TopologyState => ({
    version: v,
    nodes,
    edges,
  })

  switch (active.providerId) {
    case "ollama":
      return mk(
        [
          { id: "edge", label: "Browser", status: "idle" },
          { id: "route", label: "Local Router", status: "idle" },
          { id: "cloud", label: `Ollama @ ${base || "http://localhost:11434"}`, status: "idle" },
          { id: "sink", label: `Model · ${active.model}`, status: "idle" },
        ],
        [
          { id: "e1", source: "edge", target: "route" },
          { id: "e2", source: "route", target: "cloud" },
          { id: "e3", source: "cloud", target: "sink" },
        ]
      )
    case "openai":
      return mk(
        [
          { id: "edge", label: "Browser", status: "idle" },
          { id: "route", label: "CORS Gateway", status: "idle" },
          { id: "cloud", label: `OpenAI @ ${base || "https://api.openai.com/v1"}`, status: "idle" },
          { id: "sink", label: `Chat Completions · ${active.model}`, status: "idle" },
        ],
        [
          { id: "e1", source: "edge", target: "route" },
          { id: "e2", source: "route", target: "cloud" },
          { id: "e3", source: "cloud", target: "sink" },
        ]
      )
    case "deepseek_openai_compat":
      return mk(
        [
          { id: "edge", label: "Browser", status: "idle" },
          { id: "route", label: "CORS Gateway", status: "idle" },
          { id: "cloud", label: `DeepSeek @ ${base || "https://api.deepseek.com/v1"}`, status: "idle" },
          { id: "sink", label: `OpenAI-compat · ${active.model}`, status: "idle" },
        ],
        [
          { id: "e1", source: "edge", target: "route" },
          { id: "e2", source: "route", target: "cloud" },
          { id: "e3", source: "cloud", target: "sink" },
        ]
      )
    case "anthropic":
      return mk(
        [
          { id: "edge", label: "Browser", status: "idle" },
          { id: "route", label: "CORS Gateway", status: "idle" },
          { id: "cloud", label: `Anthropic @ ${base || "https://api.anthropic.com"}`, status: "idle" },
          { id: "sink", label: `Messages SSE · ${active.model}`, status: "idle" },
        ],
        [
          { id: "e1", source: "edge", target: "route" },
          { id: "e2", source: "route", target: "cloud" },
          { id: "e3", source: "cloud", target: "sink" },
        ]
      )
    case "google":
      return mk(
        [
          { id: "edge", label: "Browser", status: "idle" },
          { id: "route", label: "CORS Gateway", status: "idle" },
          { id: "cloud", label: `Gemini @ ${base || "https://generativelanguage.googleapis.com"}`, status: "idle" },
          { id: "sink", label: `streamGenerateContent · ${active.model}`, status: "idle" },
        ],
        [
          { id: "e1", source: "edge", target: "route" },
          { id: "e2", source: "route", target: "cloud" },
          { id: "e3", source: "cloud", target: "sink" },
        ]
      )
    default:
      return mk(initialTopology.nodes, initialTopology.edges)
  }
}

export const useAgentStore = create<AgentStore>()(
  persist(
    subscribeWithSelector((set, get) => {
      const logBuffer: Record<string, string[]> = {}
      let flushLogRaf: number | null = null

      const scheduleLogFlush = () => {
        if (typeof window === "undefined") return
        if (flushLogRaf != null) return
        flushLogRaf = window.requestAnimationFrame(() => {
          flushLogRaf = null
          set((s) => {
            const ids = Object.keys(logBuffer)
            if (ids.length === 0) return s
            const nextNodes = s.workflow.nodes.map((n) => {
              const pending = logBuffer[n.id]
              if (!pending || pending.length === 0) return n
              delete logBuffer[n.id]
              const nextLogs = [...(n.logs ?? []), ...pending].slice(-200)
              return { ...n, logs: nextLogs }
            })
            return {
              ...s,
              workflow: { ...s.workflow, version: Date.now(), nodes: nextNodes },
            }
          })
        })
      }

      return {
        settings: {
          theme: "dark",
          lang: "zh",
          inference: { temperature: 0.35, maxTokens: 1024, contextLimit: 24_000 },
          behavior: { autoSearch: true, maxRetries: 1, planningDepth: "balanced" },
          ui: { compactMode: false, showThinking: true },
        },
        ui: { activePanel: "chat", corsHelp: { open: false }, toast: { open: false } },
        chat: {
          messages: [],
        },
        conversations: {
          items: [],
          currentId: null,
          loading: false,
          cloudReady: false,
        },
        keys: { hasMasterPassword: false, hasEncryptedKeys: false, unlocked: false },
        runtimeKeys: null,
        providers: {
          active: {
            providerId: "ollama",
            model: PROVIDER_DEFAULTS.ollama.model,
            baseUrl: PROVIDER_DEFAULTS.ollama.baseUrl,
          },
        },
        probes: {
          ollama: { health: "unknown", latencyMs: null, lastCheckedAt: null },
        },
        connectivity: {},
        topology: buildTopologyForActiveProvider({
          providerId: "ollama",
          model: PROVIDER_DEFAULTS.ollama.model,
          baseUrl: PROVIDER_DEFAULTS.ollama.baseUrl,
        }),
        workflow: { version: 1, activeNodeId: null, isPlannerOutput: false, nodes: [] },
        inference: { streaming: null, last: null, history: [] },

        actions: {
          // State guard: only change activePanel string; no side effects.
          setActivePanel: (panel) => set((s) => ({ ...s, ui: { ...s.ui, activePanel: panel } })),
        setTheme: (theme) =>
          set((s) => {
            applyThemeToDom(theme)
            scheduleSettingsSync({ theme })
            return { ...s, settings: { ...s.settings, theme } }
          }),
        setLang: (lang) =>
          set((s) => ({
            ...s,
            settings: { ...s.settings, lang },
          })),
        patchSettings: (patch) =>
          set((s) => ({
            ...s,
            settings: { ...s.settings, ...patch },
          })),
        patchInferenceSettings: (patch) =>
          set((s) => ({
            ...s,
            settings: { ...s.settings, inference: { ...s.settings.inference, ...patch } },
          })),
        patchBehaviorSettings: (patch) =>
          set((s) => ({
            ...s,
            settings: { ...s.settings, behavior: { ...s.settings.behavior, ...patch } },
          })),
        patchUiSettings: (patch) =>
          set((s) => {
            const next = { ...s.settings.ui, ...patch }
            applyCompactModeToDom(!!next.compactMode)
            return {
              ...s,
              settings: { ...s.settings, ui: next },
            }
          }),
        clearSessionStorage: () =>
          set((s) => {
            clearLegacySessionKeys()
            scheduleSettingsSync({ runtimeKeys: null })
            return {
              ...s,
              runtimeKeys: null,
              keys: { ...s.keys, unlocked: false },
            }
          }),
        clearAllLocalData: () =>
          set((s) => {
            if (typeof window !== "undefined") {
              window.localStorage.removeItem("scholarkernel-agent-store")
              window.localStorage.removeItem("sk:keys:v1")
            }
            clearLegacySessionKeys()
            scheduleSettingsSync({ runtimeKeys: null })

            const nextSettings: AgentSettings = {
              theme: s.settings.theme,
              lang: s.settings.lang,
              inference: { temperature: 0.35, maxTokens: 1024, contextLimit: 24_000 },
              behavior: { autoSearch: true, maxRetries: 1, planningDepth: "balanced" },
              ui: { compactMode: false, showThinking: true },
            }
            applyCompactModeToDom(false)

            return {
              ...s,
              settings: nextSettings,
              providers: {
                ...s.providers,
                active: resetProviderDefaults("ollama"),
              },
              inference: { ...s.inference, history: [] },
              workflow: { version: 1, activeNodeId: null, isPlannerOutput: false, nodes: [] },
              runtimeKeys: null,
              keys: { ...s.keys, unlocked: false, hasEncryptedKeys: false, hasMasterPassword: false },
            }
          }),
        importConfig: ({ settings, providers }) =>
          set((s) => {
            const nextSettings: AgentSettings = {
              ...s.settings,
              ...(settings ?? {}),
              inference: { ...s.settings.inference, ...(settings?.inference ?? {}) },
              behavior: { ...s.settings.behavior, ...(settings?.behavior ?? {}) },
              ui: { ...s.settings.ui, ...(settings?.ui ?? {}) },
            }
            applyThemeToDom(nextSettings.theme)
            applyCompactModeToDom(!!nextSettings.ui.compactMode)
            const nextProviders = providers
              ? {
                  ...s.providers,
                  ...providers,
                  active: providers.active
                    ? { ...s.providers.active, ...providers.active }
                    : s.providers.active,
                }
              : s.providers
            return {
              ...s,
              settings: nextSettings,
              providers: nextProviders,
            }
          }),
        setProbe: (id, patch) =>
          set((s) => ({
            ...s,
            probes: {
              ...s.probes,
              [id]: {
                ...(s.probes[id] ?? { health: "unknown", latencyMs: null, lastCheckedAt: null }),
                ...patch,
                lastCheckedAt: now(),
              },
            },
          })),
        setConnectivity: (key, patch) =>
          set((s) => ({
            ...s,
            connectivity: {
              ...s.connectivity,
              [key]: {
                ...(s.connectivity[key] ?? {
                  health: "unknown",
                  latencyMs: null,
                  lastCheckedAt: null,
                }),
                ...patch,
                lastCheckedAt: now(),
              },
            },
          })),
        setActiveProvider: (patch) =>
          set((s) => {
            const merged: ProviderConfig = { ...s.providers.active, ...patch }
            const nextActive: ProviderConfig = {
              ...merged,
              providerId: patch.providerId ?? merged.providerId,
              model: normalizeProviderModel(merged.providerId, merged.model),
              baseUrl: patch.baseUrl !== undefined ? patch.baseUrl : merged.baseUrl,
            }
            const shouldHydrateTopology = !s.inference.streaming?.active
            return {
              ...s,
              providers: {
                ...s.providers,
                active: nextActive,
              },
              topology: shouldHydrateTopology ? buildTopologyForActiveProvider(nextActive) : s.topology,
            }
          }),
        resetProviderDefaults: (providerId) =>
          set((s) => {
            const nextActive = resetProviderDefaults(providerId)
            const shouldHydrateTopology = !s.inference.streaming?.active
            return {
              ...s,
              providers: { ...s.providers, active: nextActive },
              topology: shouldHydrateTopology ? buildTopologyForActiveProvider(nextActive) : s.topology,
            }
          }),
        setKeyStatus: (patch) =>
          set((s) => ({
            ...s,
            keys: { ...s.keys, ...(typeof patch === "function" ? patch(s.keys) : patch) },
          })),
        getRuntimeKeys: () => sanitizeRuntimeKeys(get().runtimeKeys),
        hasRuntimeKeyForProvider: (providerId) => {
          if (providerId === "ollama") return true
          const keys = sanitizeRuntimeKeys(get().runtimeKeys)
          return isUsableApiKey(getRuntimeKeyForProvider(keys, providerId))
        },
        notifyAuthFailure: (detail, status) =>
          set((s) => ({
            ...s,
            ui: {
              ...s.ui,
              toast: {
                open: true,
                id: randomId(),
                messageKey: "gateway.toast.authFailed",
                detail: detail || (status ? `HTTP ${status}` : undefined),
                variant: "error",
                shownAt: Date.now(),
                ttlMs: 6200,
              },
            },
          })),
        setRuntimeKeys: (keys) =>
          set((s) => {
            if (keys === null) {
              clearLegacySessionKeys()
              scheduleSettingsSync({ runtimeKeys: null })
              return {
                ...s,
                runtimeKeys: null,
                keys: { ...s.keys, unlocked: false },
              }
            }
            const sanitized = mergeRuntimeKeysUpdate(s.runtimeKeys, keys)
            clearLegacySessionKeys()
            scheduleSettingsSync({ runtimeKeys: sanitized ?? keys })
            const unlocked = hasAnyRuntimeKey(sanitized)
            return {
              ...s,
              runtimeKeys: sanitized,
              keys: { ...s.keys, unlocked },
            }
          }),
        setTopology: (t) => set((s) => ({ ...s, topology: t })),
        patchTopologyNodes: (patch) =>
          set((s) => ({
            ...s,
            topology: {
              ...s.topology,
              nodes: s.topology.nodes.map((n) => (patch[n.id] ? { ...n, status: patch[n.id]! } : n)),
            },
          })),
        setChatMessages: (messages) => set((s) => ({ ...s, chat: { ...s.chat, messages } })),
        pushChatMessage: (m) => {
          set((s) => ({ ...s, chat: { ...s.chat, messages: [...s.chat.messages, m] } }))
          const convId = get().conversations.currentId
          if (!convId || m.role === "system") return
          void appendMessage(convId, { id: m.id, role: m.role, content: m.content }).catch((e) =>
            console.error("[persist message]", e)
          )
        },
        patchChatMessage: (id, patch) => {
          set((s) => ({
            ...s,
            chat: { ...s.chat, messages: s.chat.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) },
          }))
          const updated = get().chat.messages.find((m) => m.id === id)
          if (updated) get().actions.persistChatMessage(updated)
        },
        persistChatMessage: (m) => {
          const convId = get().conversations.currentId
          if (!convId || m.role === "system") return

          const run = () => {
            void appendMessage(convId, { id: m.id, role: m.role, content: m.content }).catch((e) =>
              console.error("[persist message]", e)
            )
          }

          const prev = messagePersistTimers.get(m.id)
          if (prev) clearTimeout(prev)
          messagePersistTimers.set(
            m.id,
            setTimeout(() => {
              messagePersistTimers.delete(m.id)
              run()
            }, 600)
          )
        },
        initializeCloud: async () => {
          const st = get()
          if (st.conversations.cloudReady) return
          set((s) => ({ ...s, conversations: { ...s.conversations, loading: true } }))
          clearLegacySessionKeys()
          try {
            const [settings, list] = await Promise.all([fetchSettings(), fetchConversations()])
            const cloudKeys = sanitizeRuntimeKeys(settings.runtimeKeys)
            const unlocked = hasAnyRuntimeKey(cloudKeys)

            if (settings.theme === "light" || settings.theme === "dark") {
              applyThemeToDom(settings.theme)
            }

            set((s) => ({
              ...s,
              settings: { ...s.settings, theme: settings.theme ?? s.settings.theme },
              runtimeKeys: cloudKeys,
              keys: { ...s.keys, unlocked },
              conversations: {
                ...s.conversations,
                items: list,
                loading: false,
                cloudReady: true,
              },
            }))

            const urlConvId =
              typeof window !== "undefined"
                ? new URLSearchParams(window.location.search).get("c")
                : null

            if (urlConvId && list.some((c) => c.id === urlConvId)) {
              await get().actions.switchConversation(urlConvId)
            }
          } catch (e) {
            console.error("[initializeCloud]", e)
            set((s) => ({
              ...s,
              conversations: { ...s.conversations, loading: false, cloudReady: true },
            }))
          }
        },
        fetchConversationsList: async () => {
          const list = await fetchConversations()
          set((s) => ({ ...s, conversations: { ...s.conversations, items: list } }))
        },
        createConversation: async () => {
          const conv = await apiCreateConversation()
          set((s) => ({
            ...s,
            conversations: {
              ...s.conversations,
              items: [conv, ...s.conversations.items.filter((c) => c.id !== conv.id)],
              currentId: conv.id,
            },
            chat: { messages: [] },
            workflow: { version: Date.now(), activeNodeId: null, isPlannerOutput: false, nodes: [] },
            topology: buildTopologyForActiveProvider(s.providers.active),
          }))
          return conv
        },
        switchConversation: async (id) => {
          if (get().conversations.currentId === id && get().chat.messages.length > 0) return
          set((s) => ({
            ...s,
            conversations: { ...s.conversations, currentId: id, loading: true },
            workflow: { version: Date.now(), activeNodeId: null, isPlannerOutput: false, nodes: [] },
          }))
          try {
            const detail = await fetchConversation(id)
            const messages = detail.messages.map(prismaMessageToChat)
            set((s) => ({
              ...s,
              chat: { messages },
              conversations: { ...s.conversations, currentId: id, loading: false },
              topology: buildTopologyForActiveProvider(s.providers.active),
            }))
          } catch (e) {
            console.error("[switchConversation]", e)
            set((s) => ({ ...s, conversations: { ...s.conversations, loading: false } }))
          }
        },
        clearCurrentConversation: async () => {
          const convId = get().conversations.currentId
          if (!convId) return
          try {
            await clearConversationMessages(convId)
          } catch (e) {
            console.error("[clearCurrentConversation]", e)
            get().actions.pushToast({
              messageKey: "chat.clear.failed",
              detail: e instanceof Error ? e.message : undefined,
              variant: "error",
              ttlMs: 4200,
            })
            throw e
          }
          set((s) => ({
            ...s,
            chat: { messages: [] },
            workflow: { version: Date.now(), activeNodeId: null, isPlannerOutput: false, nodes: [] },
            topology: buildTopologyForActiveProvider(s.providers.active),
          }))
          get().actions.pushToast({ messageKey: "chat.clear.done", variant: "success", ttlMs: 2400 })
        },
        renameConversation: async (id, title) => {
          try {
            const updated = await apiPatchConversation(id, { title })
            set((s) => ({
              ...s,
              conversations: {
                ...s.conversations,
                items: s.conversations.items.map((c) => (c.id === id ? { ...c, ...updated } : c)),
              },
            }))
          } catch (e) {
            console.error("[renameConversation]", e)
            get().actions.pushToast({
              messageKey: "sidebar.toast.renameFailed",
              detail: e instanceof Error ? e.message : undefined,
              variant: "error",
              ttlMs: 4200,
            })
            throw e
          }
        },
        togglePinConversation: async (id, isPinned) => {
          const updated = await apiPatchConversation(id, { isPinned })
          set((s) => {
            const items = s.conversations.items.map((c) => (c.id === id ? { ...c, ...updated } : c))
            items.sort((a, b) => {
              if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
              return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
            })
            return { ...s, conversations: { ...s.conversations, items } }
          })
        },
        deleteConversation: async (id) => {
          try {
            await apiDeleteConversation(id)
          } catch (e) {
            console.error("[deleteConversation]", e)
            get().actions.pushToast({
              messageKey: "sidebar.toast.deleteFailed",
              detail: e instanceof Error ? e.message : undefined,
              variant: "error",
              ttlMs: 4200,
            })
            throw e
          }
          const st = get()
          const remaining = st.conversations.items.filter((c) => c.id !== id)
          const wasCurrent = st.conversations.currentId === id
          set((s) => ({
            ...s,
            conversations: {
              ...s.conversations,
              items: remaining,
              currentId: wasCurrent ? null : s.conversations.currentId,
            },
            ...(wasCurrent
              ? {
                  chat: { messages: [] },
                  workflow: { version: Date.now(), activeNodeId: null, isPlannerOutput: false, nodes: [] },
                  topology: buildTopologyForActiveProvider(s.providers.active),
                  inference: { ...s.inference, streaming: null },
                }
              : {}),
          }))
        },
        setWorkflowNodes: (nodes) =>
          set((s) => ({
            ...s,
            workflow: {
              ...s.workflow,
              version: Date.now(),
              nodes: nodes.map((n) => ({ ...n, logs: n.logs ?? [] })),
              activeNodeId:
                nodes.length === 0 ? null : nodes.find((n) => n.status === "running")?.id ?? s.workflow.activeNodeId,
              isPlannerOutput: nodes.length > 0,
            },
          })),
        resetWorkflowPlanOutput: () =>
          set((s) => ({
            ...s,
            workflow: { ...s.workflow, version: Date.now(), isPlannerOutput: false },
          })),
        updateNodeStatus: (id, status, metadata) =>
          set((s) => ({
            ...s,
            workflow: {
              ...s.workflow,
              version: Date.now(),
              activeNodeId: status === "running" ? id : s.workflow.activeNodeId === id ? null : s.workflow.activeNodeId,
              nodes: s.workflow.nodes.map((n) =>
                n.id === id
                  ? {
                      ...n,
                      status,
                      metadata: metadata ? { ...(n.metadata ?? {}), ...metadata } : n.metadata,
                    }
                  : n
              ),
            },
          })),
        patchWorkflowNode: (id, patch) =>
          set((s) => ({
            ...s,
            workflow: {
              ...s.workflow,
              version: Date.now(),
              activeNodeId:
                patch.status === "running"
                  ? id
                  : patch.status
                    ? s.workflow.activeNodeId === id
                      ? null
                      : s.workflow.activeNodeId
                    : s.workflow.activeNodeId,
              nodes: s.workflow.nodes.map((n) =>
                n.id === id
                  ? {
                      ...n,
                      ...patch,
                      logs: patch.logs ?? n.logs,
                      metadata: patch.metadata ? { ...(n.metadata ?? {}), ...patch.metadata } : n.metadata,
                    }
                  : n
              ),
            },
          })),
        appendNodeLog: (id, line) =>
          set((s) => {
            // Fast path for SSR / non-window: fallback to immediate set.
            if (typeof window === "undefined") {
              return {
                ...s,
                workflow: {
                  ...s.workflow,
                  version: Date.now(),
                  nodes: s.workflow.nodes.map((n) => (n.id === id ? { ...n, logs: [...n.logs, line].slice(-200) } : n)),
                },
              }
            }

            // Buffer logs and flush in rAF to avoid over-rendering.
            ;(logBuffer[id] ??= []).push(line)
            scheduleLogFlush()
            return s
          }),
        startInferenceStream: (input) =>
          set((s) => ({
            ...s,
            inference: {
              ...s.inference,
              streaming: {
                active: true,
                runId: input.runId,
                assistantMessageId: input.assistantMessageId,
                startedAt: input.startedAt,
                providerId: input.providerId,
                model: input.model,
                baseUrl: input.baseUrl,
                directChat: false,
                firstTokenAt: null,
                lastTickAt: input.startedAt,
                chars: 0,
                ttftMs: null,
                totalMs: 0,
              },
            },
          })),
        patchActiveInferenceStream: ({ runId, patch }) =>
          set((s) => {
            const cur = s.inference.streaming
            if (!cur || !cur.active || cur.runId !== runId) return s
            return {
              ...s,
              inference: {
                ...s.inference,
                streaming: { ...cur, ...patch },
              },
            }
          }),
        tickInferenceStream: ({ runId, now, charsDelta, firstToken }) =>
          set((s) => {
            const cur = s.inference.streaming
            if (!cur || !cur.active || cur.runId !== runId) return s

            const firstTokenAt = firstToken ? (cur.firstTokenAt ?? now) : cur.firstTokenAt
            const chars = cur.chars + charsDelta
            const ttftMs = firstTokenAt ? Math.round(firstTokenAt - cur.startedAt) : null
            const totalMs = Math.round(now - cur.startedAt)

            return {
              ...s,
              inference: {
                ...s.inference,
                streaming: {
                  ...cur,
                  firstTokenAt,
                  lastTickAt: now,
                  chars,
                  ttftMs,
                  totalMs,
                },
              },
            }
          }),
        finishInferenceStream: ({ runId, now, ok, error }) =>
          set((s) => {
            const cur = s.inference.streaming
            if (!cur || cur.runId !== runId) return s

            const firstTokenAt = cur.firstTokenAt
            const ttftMs = firstTokenAt ? Math.round(firstTokenAt - cur.startedAt) : null
            const totalMs = Math.round(now - cur.startedAt)

            const last: InferenceMetrics = {
              at: now,
              providerId: cur.providerId,
              model: cur.model,
              baseUrl: cur.baseUrl,
              ttftMs,
              totalMs,
              chars: cur.chars,
              ok,
              error,
            }

            return {
              ...s,
              inference: {
                streaming: null,
                last,
                history: [...s.inference.history, last].slice(-10),
              },
            }
          }),
        setInferenceLast: (m) =>
          set((s) => ({
            ...s,
            inference: {
              ...s.inference,
              last: m,
              history: m ? [...s.inference.history, m].slice(-10) : s.inference.history,
            },
          })),
        openCorsHelp: ({ providerId, baseUrl, detail }) =>
          set((s) => ({
            ...s,
            ui: {
              ...s.ui,
              corsHelp: {
                open: true,
                title: "检测到可能的 CORS 拦截",
                providerId,
                baseUrl,
                detail,
                hints: [
                  "优先方案：在本机起一个“同源网关”（例如 Next Route Handler / 本地反向代理），浏览器只访问同源路径，由网关转发到供应商域名。",
                  "开发代理：如果你用本地 dev server，可把供应商请求走 `rewrites/proxy`（避免浏览器跨域）。",
                  "不要把 API Key 写进仓库：网关侧用环境变量注入；浏览器侧仍保持“密钥不入库/不上传业务后端”的原则。",
                  "快速验证：把 Models 里的 `baseUrl` 改成你自建网关域名后，再点一次“连通性测试”。",
                ],
              },
            },
          })),
        closeCorsHelp: () => set((s) => ({ ...s, ui: { ...s.ui, corsHelp: { open: false } } })),
        pushToast: ({ messageKey, detail, variant, ttlMs }) =>
          set((s) => ({
            ...s,
            ui: {
              ...s.ui,
              toast: {
                open: true,
                id: randomId(),
                messageKey,
                detail,
                variant: variant ?? "info",
                shownAt: Date.now(),
                ttlMs: ttlMs ?? 3500,
              },
            },
          })),
        closeToast: () => set((s) => ({ ...s, ui: { ...s.ui, toast: { open: false } } })),
        resetTopology: () =>
          set((s) => ({
            ...s,
            topology: buildTopologyForActiveProvider(s.providers.active),
          })),
        heartbeatSessionKeys: () => {
          /* Route B: keys live in cloud memory; no sessionStorage heartbeat */
        },
        },
      }
    }),
    {
      name: "scholarkernel-agent-store",
      version: 5,
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Record<string, unknown>
        // Drop legacy sensitive / ephemeral fields from older persist blobs.
        delete p.runtimeKeys
        delete p.keys
        delete p.workflow
        delete p.chat
        delete p.ui
        delete p.topology
        delete p.probes
        delete p.connectivity
        return p as Partial<AgentStore>
      },
      // Precise persistence: NEVER persist runtimeKeys/workflow/inference.streaming.
      // Only allow: settings(theme/lang), providers(config), inference.history.
      partialize: (s): Partial<AgentStore> => ({
        settings: s.settings,
        providers: s.providers,
        inference: { history: s.inference.history } as AgentStore["inference"],
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AgentStore>
        return {
          ...current,
          settings: {
            ...current.settings,
            ...(p.settings ?? {}),
            inference: { ...current.settings.inference, ...(p.settings?.inference ?? {}) },
            behavior: { ...current.settings.behavior, ...(p.settings?.behavior ?? {}) },
            ui: { ...current.settings.ui, ...(p.settings?.ui ?? {}) },
          },
          providers: p.providers ?? current.providers,
          inference: {
            ...current.inference,
            history: p.inference?.history ?? current.inference.history,
          },
        } as AgentStore
      },
      onRehydrateStorage: () => (state) => {
        clearLegacySessionKeys()
        const theme = state?.settings?.theme ?? "dark"
        applyThemeToDom(theme)
        applyCompactModeToDom(!!state?.settings?.ui?.compactMode)
      },
    }
  )
)

/** 最近一次对话推理指标（绑定 Cloud Metrics 面板） */
export const selectLastChatInference = (s: AgentStore) => s.inference.last

/** 发起云请求前调用：无 Key 则抛错（由网关层映射为 MissingApiKey） */
export function requireRuntimeKeyForProvider(
  providerId: ProviderId,
  keys?: RuntimeKeys | null
): string {
  if (providerId === "ollama") return ""
  let rk = keys ?? null
  if (!rk) {
    try {
      rk = useAgentStore.getState().runtimeKeys ?? null
    } catch {
      rk = null
    }
  }
  const key = getRuntimeKeyForProvider(rk, providerId)
  if (!isUsableApiKey(key)) throw new Error("MissingApiKey")
  return key
}

