import { prisma } from "@/lib/prisma"
import { createFileTool } from "@/lib/tools/file-tool"
import { createOwnedDocumentReader } from "@/lib/document-service"
import { AgentExecutor } from "@/lib/agent-executor"
import { runtimeKeysFromEnv } from "@/lib/agent/llm-utils"
import type { AgentExecutorDeps, AgentExecutorHooks } from "@/lib/agent/executor-types"
import type { PeerReviewCheckpointData } from "@/lib/agent/peer-review-checkpoint"
import type { ActiveProviderConfig, ChatHistoryEntry } from "@/lib/agent/planner"
import { createTokenUsageRecorder } from "@/lib/billing/token-audit"
import { searchConversationDocumentChunks } from "@/lib/document/search-conversation-chunks"

export type AgentRunInput = {
  userId?: string
  userInput: string
  activeProvider: ActiveProviderConfig
  jobId?: string
  conversationId?: string
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
  resumeCheckpoint?: AgentExecutorDeps["resumeCheckpoint"]
  suspendForIntervention?: boolean
  flushCheckpoint?: AgentExecutorDeps["flushCheckpoint"]
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

  const usageWrites: Promise<unknown>[] = []
  const executor = new AgentExecutor(
    {
      localFileTool: createFileTool(createOwnedDocumentReader(input.userId)),
      readDocument: createOwnedDocumentReader(input.userId),
      userId: input.userId,
      conversationId: input.conversationId,
      activeProvider: input.activeProvider,
      jobId: input.jobId,
      trackUsageWrite: write => { usageWrites.push(write) },
      recordTokenUsage: billingRecorder
        ? (payload) => billingRecorder.record(payload)
        : undefined,
      interventionSessionId: input.interventionSessionId ?? input.jobId,
      getInterventionDecision: input.userId && input.jobId ? async (nodeId) => {
        const saved = await prisma.agentIntervention.findFirst({ where: { jobId: input.jobId, userId: input.userId, nodeId } })
        if (!saved) return null
        return saved.action === "redirect" ? { action: "redirect", instruction: saved.instruction ?? "" } : { action: "approve" }
      } : undefined,
      peerReviewCheckpoint: input.peerReviewCheckpoint,
      onPeerReviewCheckpoint: input.onPeerReviewCheckpoint,
      inference: input.inference,
      runtimeKeys,
      getRuntimeKeys: () => runtimeKeys,
      search: { tavilyApiKey: runtimeKeys.tavily, serperApiKey: runtimeKeys.serper },
      retrieveLocalEvidence: input.userId && input.conversationId
        ? (query) => searchConversationDocumentChunks(input.userId!, input.conversationId!, query)
        : undefined,
      getChatHistory: () => input.chatHistory ?? [],
      sourceApiBase: input.sourceApiBase,
      signal: input.signal,
      localOnly: input.localOnly,
      resumeCheckpoint: input.resumeCheckpoint,
      suspendForIntervention: input.suspendForIntervention,
      flushCheckpoint: input.flushCheckpoint,
    },
    hooks
  )

  try {
    return await executor.run(input.userInput, input.planRetryMessage ? { planRetryMessage: input.planRetryMessage } : undefined)
  } finally {
    await Promise.all(usageWrites)
    await billingRecorder?.flush()
  }
}
