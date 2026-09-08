import { AgentExecutor, isDirectChatInput } from "@/lib/agent-executor"
import { resolveLibraryEvidenceForAgent } from "@/lib/library-resolve"
import { runtimeKeysFromEnv } from "@/lib/agent/llm-utils"
import type { AgentExecutorDeps, AgentExecutorHooks } from "@/lib/agent/executor-types"
import type { PeerReviewCheckpointData } from "@/lib/agent/peer-review-checkpoint"
import { snapshotsFromWorkflowNodes, type NodeSnapshotRecord } from "@/lib/agent/node-resume"
import type { ActiveProviderConfig, ChatHistoryEntry, WorkflowNode } from "@/lib/agent/planner"
import { createTokenUsageRecorder } from "@/lib/billing/token-audit"
import { loadAgentNodeSnapshots, persistAgentNodeSnapshotAsync } from "@/lib/agent-jobs"
import { runAgentWorkflowDag } from "@/lib/agent/agent-dag-runtime"

export type AgentRunInput = {
  userId?: string
  userInput: string
  activeProvider: ActiveProviderConfig
  jobId?: string
  /** 断点续跑：仅重试该节点及其后续 */
  targetNodeId?: string
  interventionSessionId?: string
  peerReviewCheckpoint?: PeerReviewCheckpointData | null
  onPeerReviewCheckpoint?: AgentExecutorDeps["onPeerReviewCheckpoint"]
  chatHistory?: ChatHistoryEntry[]
  inference?: AgentExecutorDeps["inference"]
  localOnly?: boolean
  planRetryMessage?: string
  runtimeKeys?: AgentExecutorDeps["runtimeKeys"]
  sourceApiBase?: string
  signal?: AbortSignal
  resumeNodes?: WorkflowNode[]
  resumeSnapshots?: NodeSnapshotRecord[]
  documentIds?: string[]
}

export function mergeRuntimeKeysForServer(
  bodyKeys: AgentExecutorDeps["runtimeKeys"] | undefined,
  envKeys: NonNullable<AgentExecutorDeps["runtimeKeys"]>
): NonNullable<AgentExecutorDeps["runtimeKeys"]> {
  return {
    openai: bodyKeys?.openai?.trim() || envKeys.openai,
    anthropic: bodyKeys?.anthropic?.trim() || envKeys.anthropic,
    google: bodyKeys?.google?.trim() || envKeys.google,
    deepseek: bodyKeys?.deepseek?.trim() || envKeys.deepseek,
    tavily: bodyKeys?.tavily?.trim() || envKeys.tavily,
    serper: bodyKeys?.serper?.trim() || envKeys.serper,
  }
}

export async function runAgentOnServer(
  input: AgentRunInput,
  hooks?: AgentExecutorHooks
) {
  const envKeys = runtimeKeysFromEnv()
  const runtimeKeys = mergeRuntimeKeysForServer(input.runtimeKeys, envKeys)
  const billingRecorder = input.userId ? createTokenUsageRecorder(input.userId, input.jobId) : null
  const recordTokenUsage: AgentExecutorDeps["recordTokenUsage"] = billingRecorder
    ? (payload) => {
        billingRecorder.record(payload)
        hooks?.onUsage?.({ model: payload.modelUsed, inputTokens: payload.inputTokens, outputTokens: payload.outputTokens, ttftMs: payload.ttftMs })
      }
    : undefined
  const libraryResolution = await resolveLibraryEvidenceForAgent(input.userId, input.documentIds, input.userInput)
  if (libraryResolution.statuses.length) hooks?.onEvidenceStatus?.(libraryResolution.statuses)

  let resumeSnapshots = input.resumeSnapshots
  if (input.jobId && input.resumeNodes?.length && !resumeSnapshots?.length) {
    resumeSnapshots = await loadAgentNodeSnapshots(input.jobId)
  }
  if (input.targetNodeId && !resumeSnapshots?.length && input.resumeNodes?.length) {
    resumeSnapshots = snapshotsFromWorkflowNodes(input.resumeNodes)
  }

  const executor = new AgentExecutor(
    {
      userId: input.userId,
      activeProvider: input.activeProvider,
      jobId: input.jobId,
      targetNodeId: input.targetNodeId,
      resumeSnapshots,
      resumeNodes: input.resumeNodes,
      onNodeSnapshotPersist: input.jobId
        ? (record) => {
            void persistAgentNodeSnapshotAsync(input.jobId!, record)
          }
        : undefined,
      recordTokenUsage,
      interventionSessionId: input.interventionSessionId ?? input.jobId,
      peerReviewCheckpoint: input.peerReviewCheckpoint,
      onPeerReviewCheckpoint: input.onPeerReviewCheckpoint,
      inference: input.inference,
      runtimeKeys,
      getRuntimeKeys: () => runtimeKeys,
      search: { tavilyApiKey: runtimeKeys.tavily, serperApiKey: runtimeKeys.serper },
      getChatHistory: () => input.chatHistory ?? [],
      sourceApiBase: input.sourceApiBase,
      signal: input.signal,
      localOnly: input.localOnly,
      documentIds: input.documentIds,
      libraryEvidence: libraryResolution.evidence,
    },
    hooks
  )

  if (!input.documentIds?.length && isDirectChatInput(input.userInput)) return executor.run(input.userInput, {
    ...(input.planRetryMessage ? { planRetryMessage: input.planRetryMessage } : {}),
    ...(input.targetNodeId ? { targetNodeId: input.targetNodeId } : {}),
    ...(input.resumeNodes?.length ? { resumeNodes: input.resumeNodes } : {}),
  })

  return runAgentWorkflowDag({
    executor,
    userInput: input.userInput,
    deps: {
      userId: input.userId,
      activeProvider: input.activeProvider,
      jobId: input.jobId,
      targetNodeId: input.targetNodeId,
      resumeSnapshots,
      interventionSessionId: input.interventionSessionId ?? input.jobId,
      peerReviewCheckpoint: input.peerReviewCheckpoint,
      onPeerReviewCheckpoint: input.onPeerReviewCheckpoint,
      inference: input.inference,
      runtimeKeys,
      getRuntimeKeys: () => runtimeKeys,
      search: { tavilyApiKey: runtimeKeys.tavily, serperApiKey: runtimeKeys.serper },
      getChatHistory: () => input.chatHistory ?? [],
      sourceApiBase: input.sourceApiBase,
      signal: input.signal,
      localOnly: input.localOnly,
      documentIds: input.documentIds,
      libraryEvidence: libraryResolution.evidence,
      recordTokenUsage,
    },
    hooks,
    resumeNodes: input.resumeNodes,
    planRetryMessage: input.planRetryMessage,
  })
}
