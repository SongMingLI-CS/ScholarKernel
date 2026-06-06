import { AgentExecutor } from "@/lib/agent-executor"
import { runtimeKeysFromEnv } from "@/lib/agent/llm-utils"
import type { AgentExecutorDeps, AgentExecutorHooks } from "@/lib/agent/executor-types"
import type { PeerReviewCheckpointData } from "@/lib/agent/peer-review-checkpoint"
import type { ActiveProviderConfig, ChatHistoryEntry } from "@/lib/agent/planner"

export type AgentRunInput = {
  userInput: string
  activeProvider: ActiveProviderConfig
  jobId?: string
  peerReviewCheckpoint?: PeerReviewCheckpointData | null
  onPeerReviewCheckpoint?: AgentExecutorDeps["onPeerReviewCheckpoint"]
  chatHistory?: ChatHistoryEntry[]
  inference?: AgentExecutorDeps["inference"]
  localOnly?: boolean
  planRetryMessage?: string
  runtimeKeys?: AgentExecutorDeps["runtimeKeys"]
  sourceApiBase?: string
  signal?: AbortSignal
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

  const executor = new AgentExecutor(
    {
      activeProvider: input.activeProvider,
      jobId: input.jobId,
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
    },
    hooks
  )

  return executor.run(input.userInput, input.planRetryMessage ? { planRetryMessage: input.planRetryMessage } : undefined)
}
