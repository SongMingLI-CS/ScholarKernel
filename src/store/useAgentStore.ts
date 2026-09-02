import { create } from "zustand"
import { persist, subscribeWithSelector } from "zustand/middleware"

import type { ConversationSummary, ScholarDocument } from "@/lib/db-types"
import { stripRedactedThinking } from "@/lib/r1-stream-parser"
import { prismaMessageToChat, chatMessageToCreateBody } from "@/lib/db-types"
import {
  appendMessage,
  clearConversationMessages,
  createConversation as apiCreateConversation,
  createDocument as apiCreateDocument,
  deleteConversation as apiDeleteConversation,
  fetchConversation,
  fetchConversations,
  fetchSettings,
  isApiUnauthorizedError,
  isApiRateLimitError,
  patchConversation as apiPatchConversation,
  patchDocument as apiPatchDocument,
} from "@/lib/conversation-api"
import {
  createOptimisticConversation,
  createTempConversationId,
  isTempConversationId,
  reduceOptimisticConversationState,
  replaceConversationIdInUrl,
  rollbackChatMessages,
} from "@/lib/optimistic-ui"
import { buildTemplateWorkflowNodes, createOptimisticConversationFromTemplate, getTemplateById } from "@/lib/template-hub"

import {
  PROVIDER_DEFAULTS,
  normalizeProviderModel,
  resetProviderDefaults,
  scheduleSettingsSync,
} from "@/store/provider-config"
import {
  clearLegacySessionKeys,
  getRuntimeKeyForProvider,
  isUsableApiKey,
  mergeRuntimeKeysUpdate,
  sanitizeRuntimeKeys,
} from "@/store/runtime-keys"

export type {
  AgentSettings,
  ChatMessage,
  ConnectionHealth,
  CorsHelpState,
  Health,
  InferenceMetrics,
  KeyStatus,
  Lang,
  ModelConnectivity,
  PanelId,
  ProbeId,
  ProbeState,
  ProviderConfig,
  ProviderId,
  RuntimeKeyField,
  RuntimeKeys,
  StartInferenceStreamInput,
  StreamingInferenceMetrics,
  ThemeMode,
  ToastState,
  ToastVariant,
  TopologyState,
  WorkflowNode,
  WorkflowNodeProvider,
  WorkflowNodeStatus,
  WorkflowNodeType,
} from "@/store/types"

export {
  EMPTY_RUNTIME_KEYS,
  RUNTIME_KEY_FIELDS,
  getRuntimeKeyForProvider,
  hasRuntimeKeyForProvider,
  isUsableApiKey,
  mergeRuntimeKeysUpdate,
  sanitizeRuntimeKeys,
} from "@/store/runtime-keys"

import type { AcademicReference } from "@/lib/utils/citation-parser"

import type {
  AgentSettings,
  ChatMessage,
  CorsHelpState,
  InferenceMetrics,
  KeyStatus,
  Lang,
  ModelConnectivity,
  PanelId,
  ProbeId,
  ProbeState,
  ProviderConfig,
  ProviderId,
  RuntimeKeys,
  StartInferenceStreamInput,
  StreamingInferenceMetrics,
  ThemeMode,
  ToastState,
  ToastVariant,
  TopologyState,
  WorkflowNode,
  WorkflowNodeStatus,
} from "@/store/types"

const messagePersistTimers = new Map<string, ReturnType<typeof setTimeout>>()
const documentPersistTimer: { id: ReturnType<typeof setTimeout> | null } = { id: null }
/** Tracks in-flight optimistic conversation creates keyed by temp id. */
const pendingConversationCreates = new Map<string, Promise<ConversationSummary>>()
/** Temp ids dismissed locally before server reconcile (delete / rollback). */
const dismissedTempConversationIds = new Set<string>()

async function flushChatMessagesToServer(convId: string, messages: ChatMessage[]): Promise<void> {
  for (const m of messages) {
    if (m.role === "system") continue
    await appendMessage(convId, chatMessageToCreateBody(m))
  }
}

function revokeSessionPdfUrl(url: string | null | undefined) {
  if (typeof window !== "undefined" && url?.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }
}

function resetConversationWorkspace(s: AgentStore): Partial<AgentStore> {
  revokeSessionPdfUrl(s.pdfCoReader.sessionPdfUrl)
  return {
    chat: { messages: [], attachedReferences: [], selectedLibraryDocuments: [] },
    workflow: { version: Date.now(), activeNodeId: null, isPlannerOutput: false, nodes: [] },
    topology: buildTopologyForActiveProvider(s.providers.active),
    canvas: { activeDocument: null, canvasOpen: false },
    pdfCoReader: {
      viewMode: "canvas",
      sessionPdfUrl: null,
      sessionPdfName: null,
      targetPage: null,
      scrollNonce: 0,
    },
  }
}

type AgentStore = {
  settings: AgentSettings
  ui: {
    activePanel: PanelId
    corsHelp: CorsHelpState
    toast: ToastState
    sidebarDrawerOpen: boolean
  }
  chat: {
    messages: ChatMessage[]
    attachedReferences: AcademicReference[]
    selectedLibraryDocuments: Array<{ id: string; title: string }>
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
  canvas: {
    activeDocument: ScholarDocument | null
    canvasOpen: boolean
  }
  pdfCoReader: {
    viewMode: "canvas" | "pdf"
    sessionPdfUrl: string | null
    sessionPdfName: string | null
    targetPage: number | null
    scrollNonce: number
  }
  intervention: {
    sessionId: string | null
    pendingNodeId: string | null
    reason: string | null
  }

  actions: {
    setActivePanel: (panel: PanelId) => void
    setSidebarDrawerOpen: (open: boolean) => void
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
    rollbackChatMessages: (ids: string[]) => void
    patchChatMessage: (id: string, patch: Partial<ChatMessage>) => void
    setAttachedReferences: (refs: AcademicReference[]) => void
    appendAttachedReferences: (refs: AcademicReference[]) => void
    clearAttachedReferences: () => void
    setSelectedLibraryDocuments: (docs: Array<{ id: string; title: string }>) => void
    clearSelectedLibraryDocuments: () => void
    /** Route B: bootstrap cloud settings + conversation list */
    initializeCloud: () => Promise<void>
    fetchConversationsList: () => Promise<void>
    createConversation: (opts?: {
      awaitPersist?: boolean
      templateId?: string
    }) => Promise<ConversationSummary>
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
    applyNodeProgress: (payload: import("@/lib/agent/executor-types").NodeProgressPayload) => void
    setInterventionPending: (input: { sessionId: string; nodeId: string; reason: string }) => void
    clearInterventionPending: () => void
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
    setCanvasOpen: (open: boolean) => void
    closeCanvas: () => void
    applyScholarCanvasStream: (input: { title: string; content: string; complete: boolean }) => void
    updateCanvasContent: (content: string) => void
    setCoReaderViewMode: (mode: "canvas" | "pdf") => void
    setSessionPdfUrl: (input: { url: string; name: string } | null) => void
    scrollToPdfPage: (pageNumber: number) => void
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
          behavior: { autoSearch: true, maxRetries: 1, planningDepth: "balanced", localOnly: false },
          ui: { compactMode: false, showThinking: true },
        },
        ui: { activePanel: "chat", corsHelp: { open: false }, toast: { open: false }, sidebarDrawerOpen: false },
        chat: {
          messages: [],
          attachedReferences: [],
          selectedLibraryDocuments: [],
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
        canvas: { activeDocument: null, canvasOpen: false },
        pdfCoReader: {
          viewMode: "canvas",
          sessionPdfUrl: null,
          sessionPdfName: null,
          targetPage: null,
          scrollNonce: 0,
        },
        intervention: { sessionId: null, pendingNodeId: null, reason: null },

        actions: {
          // State guard: only change activePanel string; no side effects.
          setActivePanel: (panel) => set((s) => ({ ...s, ui: { ...s.ui, activePanel: panel } })),
          setSidebarDrawerOpen: (open) => set((s) => ({ ...s, ui: { ...s.ui, sidebarDrawerOpen: open } })),
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
              behavior: { autoSearch: true, maxRetries: 1, planningDepth: "balanced", localOnly: false },
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
            const unlocked = sanitized != null
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
        setAttachedReferences: (refs) =>
          set((s) => ({ ...s, chat: { ...s.chat, attachedReferences: refs } })),
        appendAttachedReferences: (refs) => {
          if (!refs.length) return
          set((s) => ({
            ...s,
            chat: { ...s.chat, attachedReferences: [...s.chat.attachedReferences, ...refs] },
          }))
        },
        clearAttachedReferences: () => set((s) => ({ ...s, chat: { ...s.chat, attachedReferences: [] } })),
        setSelectedLibraryDocuments: (docs) =>
          set((s) => ({ ...s, chat: { ...s.chat, selectedLibraryDocuments: docs } })),
        clearSelectedLibraryDocuments: () =>
          set((s) => ({ ...s, chat: { ...s.chat, selectedLibraryDocuments: [] } })),
        pushChatMessage: (m) => {
          set((s) => ({ ...s, chat: { ...s.chat, messages: [...s.chat.messages, m] } }))
          const convId = get().conversations.currentId
          if (!convId || m.role === "system" || isTempConversationId(convId)) return
          void appendMessage(convId, chatMessageToCreateBody(m)).catch((e) => {
            console.error("[persist message]", e)
            const rollbackIds = [m.id]
            if (isApiRateLimitError(e)) {
              const msgs = get().chat.messages
              const last = msgs[msgs.length - 1]
              if (last?.role === "assistant" && last.id !== m.id && !last.content?.trim()) {
                rollbackIds.push(last.id)
              }
            }
            get().actions.rollbackChatMessages(rollbackIds)
            get().actions.pushToast(
              isApiRateLimitError(e)
                ? { messageKey: "rateLimit.toast", variant: "warning", ttlMs: 5200 }
                : {
                    messageKey: "optimistic.networkFailed",
                    detail: e instanceof Error ? e.message : undefined,
                    variant: "error",
                    ttlMs: 5200,
                  }
            )
          })
        },
        rollbackChatMessages: (ids) => {
          if (!ids.length) return
          set((s) => ({
            ...s,
            chat: { ...s.chat, messages: rollbackChatMessages(s.chat.messages, ids) },
          }))
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
          if (!convId || m.role === "system" || isTempConversationId(convId)) return

          const run = () => {
            void appendMessage(convId, chatMessageToCreateBody(m)).catch((e) => {
              console.error("[persist message]", e)
              get().actions.rollbackChatMessages([m.id])
              get().actions.pushToast(
                isApiRateLimitError(e)
                  ? { messageKey: "rateLimit.toast", variant: "warning", ttlMs: 5200 }
                  : {
                      messageKey: "optimistic.networkFailed",
                      detail: e instanceof Error ? e.message : undefined,
                      variant: "error",
                      ttlMs: 5200,
                    }
              )
            })
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
            const unlocked = cloudKeys != null

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
            if (isApiUnauthorizedError(e)) {
              get().actions.pushToast({
                messageKey: "session.heartbeat.expired",
                variant: "error",
                ttlMs: 6200,
              })
            }
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
        createConversation: async (opts) => {
          const tempId = createTempConversationId()
          const templateId = opts?.templateId
          const template = templateId ? getTemplateById(templateId) : null
          const optimistic =
            template && templateId
              ? (createOptimisticConversationFromTemplate(tempId, templateId) ??
                createOptimisticConversation(tempId))
              : createOptimisticConversation(tempId)

          set((s) => {
            const convPatch = reduceOptimisticConversationState(
              { items: s.conversations.items, currentId: s.conversations.currentId },
              { type: "create", tempId, optimistic }
            )
            const workspace = resetConversationWorkspace(s)
            if (template) {
              workspace.chat = { messages: [], attachedReferences: [], selectedLibraryDocuments: [] }
              workspace.workflow = {
                version: Date.now(),
                activeNodeId: null,
                isPlannerOutput: true,
                nodes: buildTemplateWorkflowNodes(template),
              }
              workspace.topology = buildTopologyForActiveProvider(s.providers.active)
            }
            return {
              ...s,
              conversations: {
                ...s.conversations,
                items: convPatch.items,
                currentId: convPatch.currentId,
              },
              ...workspace,
            }
          })

          const persistPromise = (async () => {
            try {
              const conv = await apiCreateConversation(templateId ? { templateId } : undefined)
              pendingConversationCreates.delete(tempId)

              if (dismissedTempConversationIds.has(tempId)) {
                dismissedTempConversationIds.delete(tempId)
                void apiDeleteConversation(conv.id).catch(() => {})
                return conv
              }

              const st = get()
              const wasCurrent = st.conversations.currentId === tempId
              const messagesToFlush = wasCurrent ? [...st.chat.messages] : []

              set((s) => {
                const convPatch = reduceOptimisticConversationState(
                  { items: s.conversations.items, currentId: s.conversations.currentId },
                  { type: "reconcile", tempId, real: conv }
                )
                const next: Partial<AgentStore> = {
                  ...s,
                  conversations: {
                    ...s.conversations,
                    items: convPatch.items,
                    currentId: convPatch.currentId,
                  },
                }
                if (wasCurrent && conv.templateBootstrap?.initialAgents?.length) {
                  next.workflow = {
                    version: Date.now(),
                    activeNodeId: null,
                    isPlannerOutput: true,
                    nodes: conv.templateBootstrap.initialAgents,
                  }
                }
                return next as AgentStore
              })

              if (wasCurrent) {
                replaceConversationIdInUrl(tempId, conv.id)
                if (messagesToFlush.length > 0) {
                  await flushChatMessagesToServer(conv.id, messagesToFlush)
                }
              }

              return conv
            } catch (e) {
              pendingConversationCreates.delete(tempId)
              console.error("[createConversation]", e)

              if (!dismissedTempConversationIds.has(tempId)) {
                const st = get()
                const wasCurrent = st.conversations.currentId === tempId
                set((s) => {
                  const convPatch = reduceOptimisticConversationState(
                    { items: s.conversations.items, currentId: s.conversations.currentId },
                    { type: "rollback", tempId }
                  )
                  return {
                    ...s,
                    conversations: {
                      ...s.conversations,
                      items: convPatch.items,
                      currentId: convPatch.currentId,
                    },
                    ...(wasCurrent ? resetConversationWorkspace(s) : {}),
                  }
                })

                if (isApiUnauthorizedError(e)) {
                  get().actions.pushToast({
                    messageKey: "session.heartbeat.expired",
                    variant: "error",
                    ttlMs: 6200,
                  })
                } else if (isApiRateLimitError(e)) {
                  get().actions.pushToast({
                    messageKey: "rateLimit.toast",
                    variant: "warning",
                    ttlMs: 5200,
                  })
                } else {
                  get().actions.pushToast({
                    messageKey: "optimistic.networkFailed",
                    detail: e instanceof Error ? e.message : undefined,
                    variant: "error",
                    ttlMs: 5200,
                  })
                }
              } else {
                dismissedTempConversationIds.delete(tempId)
              }

              throw e
            }
          })()

          pendingConversationCreates.set(tempId, persistPromise)

          if (opts?.awaitPersist) {
            return persistPromise
          }
          return optimistic
        },
        switchConversation: async (id) => {
          if (get().conversations.currentId === id && get().chat.messages.length > 0) return

          if (isTempConversationId(id)) {
            set((s) => ({
              ...s,
              conversations: { ...s.conversations, currentId: id, loading: false },
              ...(s.conversations.currentId !== id ? resetConversationWorkspace(s) : {}),
            }))
            return
          }

          set((s) => {
            revokeSessionPdfUrl(s.pdfCoReader.sessionPdfUrl)
            return {
              ...s,
              conversations: { ...s.conversations, currentId: id, loading: true },
              workflow: { version: Date.now(), activeNodeId: null, isPlannerOutput: false, nodes: [] },
              canvas: { activeDocument: null, canvasOpen: false },
              pdfCoReader: {
                viewMode: "canvas",
                sessionPdfUrl: null,
                sessionPdfName: null,
                targetPage: null,
                scrollNonce: 0,
              },
            }
          })
          try {
            const detail = await fetchConversation(id)
            const messages = detail.messages.map(prismaMessageToChat)
            set((s) => ({
              ...s,
              chat: { messages, attachedReferences: [], selectedLibraryDocuments: [] },
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
          if (isTempConversationId(convId)) {
            set((s) => ({
              ...s,
              chat: { messages: [], attachedReferences: [], selectedLibraryDocuments: [] },
              workflow: { version: Date.now(), activeNodeId: null, isPlannerOutput: false, nodes: [] },
              topology: buildTopologyForActiveProvider(s.providers.active),
            }))
            get().actions.pushToast({ messageKey: "chat.clear.done", variant: "success", ttlMs: 2400 })
            return
          }
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
            chat: { messages: [], attachedReferences: [], selectedLibraryDocuments: [] },
            workflow: { version: Date.now(), activeNodeId: null, isPlannerOutput: false, nodes: [] },
            topology: buildTopologyForActiveProvider(s.providers.active),
          }))
          get().actions.pushToast({ messageKey: "chat.clear.done", variant: "success", ttlMs: 2400 })
        },
        renameConversation: async (id, title) => {
          if (isTempConversationId(id)) {
            set((s) => ({
              ...s,
              conversations: {
                ...s.conversations,
                items: s.conversations.items.map((c) =>
                  c.id === id ? { ...c, title, updatedAt: new Date().toISOString() } : c
                ),
              },
            }))
            const pending = pendingConversationCreates.get(id)
            if (pending) {
              void pending
                .then((conv) => apiPatchConversation(conv.id, { title }))
                .catch((e) => console.error("[renameConversation optimistic]", e))
            }
            return
          }
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
          if (isTempConversationId(id)) {
            dismissedTempConversationIds.add(id)
            pendingConversationCreates.delete(id)
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
                    ...resetConversationWorkspace(s),
                    inference: { ...s.inference, streaming: null },
                  }
                : {}),
            }))
            return
          }
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
                  chat: { messages: [], attachedReferences: [], selectedLibraryDocuments: [] },
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
                patch.status === "running" || patch.status === "pending_approval"
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
        applyNodeProgress: (payload) =>
          set((s) => ({
            ...s,
            workflow: {
              ...s.workflow,
              version: Date.now(),
              nodes: s.workflow.nodes.map((n) => {
                if (n.id !== payload.nodeId) return n
                const meta = { ...(n.metadata ?? {}) }
                const drafts = (meta["streamDrafts"] as Record<string, string> | undefined) ?? {}
                const statusLines = (meta["streamStatusLines"] as Record<string, string[]> | undefined) ?? {}

                if (
                  (payload.kind === "stream_delta" || payload.kind === "stream_complete") &&
                  typeof payload.text === "string"
                ) {
                  meta["streamDrafts"] = { ...drafts, [payload.streamId]: payload.text }
                  meta["activeStreamId"] = payload.streamId
                }

                if (payload.kind === "status_line" && payload.line) {
                  meta["streamStatusLines"] = {
                    ...statusLines,
                    [payload.streamId]: [...(statusLines[payload.streamId] ?? []), payload.line].slice(-32),
                  }
                }

                return { ...n, metadata: meta }
              }),
            },
          })),
        setInterventionPending: ({ sessionId, nodeId, reason }) =>
          set((s) => ({
            ...s,
            intervention: { sessionId, pendingNodeId: nodeId, reason },
          })),
        clearInterventionPending: () =>
          set((s) => ({
            ...s,
            intervention: { sessionId: null, pendingNodeId: null, reason: null },
          })),
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
        setCanvasOpen: (open) => set((s) => ({ ...s, canvas: { ...s.canvas, canvasOpen: open } })),
        closeCanvas: () =>
          set((s) => ({
            ...s,
            canvas: { activeDocument: s.canvas.activeDocument, canvasOpen: false },
          })),
        applyScholarCanvasStream: ({ title, content, complete }) => {
          const st = get()
          const convId = st.conversations.currentId
          const prev = st.canvas.activeDocument
          const nowIso = new Date().toISOString()
          const safeContent = stripRedactedThinking(content)

          const nextDoc: ScholarDocument = prev
            ? {
                ...prev,
                title: title.trim() || prev.title,
                content: safeContent,
                updatedAt: nowIso,
                ...(complete && content !== prev.content ? { version: prev.version + 1 } : {}),
              }
            : {
                id: `local-${randomId()}`,
                conversationId: convId ?? "",
                title: title.trim() || "未命名文档",
                content: safeContent,
                version: 1,
                createdAt: nowIso,
                updatedAt: nowIso,
              }

          set((s) => ({
            ...s,
            canvas: { activeDocument: nextDoc, canvasOpen: true },
          }))

          if (!convId) return

          const schedulePersist = () => {
            if (documentPersistTimer.id) clearTimeout(documentPersistTimer.id)
            documentPersistTimer.id = setTimeout(() => {
              documentPersistTimer.id = null
              const cur = get()
              const doc = cur.canvas.activeDocument
              const cid = cur.conversations.currentId
              if (!doc || !cid) return

              if (doc.id.startsWith("local-")) {
                void apiCreateDocument(cid, { title: doc.title, content: doc.content })
                  .then((saved) => {
                    set((s) => ({
                      ...s,
                      canvas: {
                        ...s.canvas,
                        activeDocument: s.canvas.activeDocument?.id === doc.id ? saved : s.canvas.activeDocument,
                      },
                    }))
                  })
                  .catch((e) => console.error("[create document]", e))
                return
              }

              void apiPatchDocument(cid, doc.id, { title: doc.title, content: doc.content }).catch((e) =>
                console.error("[patch document]", e)
              )
            }, complete ? 400 : 900)
          }

          schedulePersist()
        },
        updateCanvasContent: (content) => {
          const st = get()
          const prev = st.canvas.activeDocument
          if (!prev) return
          const nowIso = new Date().toISOString()
          const nextDoc: ScholarDocument = { ...prev, content, updatedAt: nowIso }
          set((s) => ({
            ...s,
            canvas: { ...s.canvas, activeDocument: nextDoc },
          }))

          const convId = st.conversations.currentId
          if (!convId) return

          if (documentPersistTimer.id) clearTimeout(documentPersistTimer.id)
          documentPersistTimer.id = setTimeout(() => {
            documentPersistTimer.id = null
            const cur = get()
            const doc = cur.canvas.activeDocument
            const cid = cur.conversations.currentId
            if (!doc || !cid) return

            if (doc.id.startsWith("local-")) {
              void apiCreateDocument(cid, { title: doc.title, content: doc.content })
                .then((saved) => {
                  set((s) => ({
                    ...s,
                    canvas: {
                      ...s.canvas,
                      activeDocument: s.canvas.activeDocument?.id === doc.id ? saved : s.canvas.activeDocument,
                    },
                  }))
                })
                .catch((e) => console.error("[create document]", e))
              return
            }

            void apiPatchDocument(cid, doc.id, { title: doc.title, content: doc.content }).catch((e) =>
              console.error("[patch document]", e)
            )
          }, 900)
        },
        setCoReaderViewMode: (mode) =>
          set((s) => ({
            ...s,
            pdfCoReader: { ...s.pdfCoReader, viewMode: mode },
          })),
        setSessionPdfUrl: (input) =>
          set((s) => {
            if (input?.url === s.pdfCoReader.sessionPdfUrl) {
              return {
                ...s,
                pdfCoReader: { ...s.pdfCoReader, sessionPdfName: input.name },
              }
            }
            revokeSessionPdfUrl(s.pdfCoReader.sessionPdfUrl)
            return {
              ...s,
              pdfCoReader: {
                ...s.pdfCoReader,
                sessionPdfUrl: input?.url ?? null,
                sessionPdfName: input?.name ?? null,
              },
            }
          }),
        scrollToPdfPage: (pageNumber) => {
          const page = Math.max(1, Math.floor(pageNumber))
          set((s) => ({
            ...s,
            canvas: { ...s.canvas, canvasOpen: true },
            pdfCoReader: {
              ...s.pdfCoReader,
              viewMode: "pdf",
              targetPage: page,
              scrollNonce: Date.now(),
            },
          }))
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

