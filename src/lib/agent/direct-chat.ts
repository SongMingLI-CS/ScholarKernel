import { streamText } from "ai"
import { ACADEMIC_OUTPUT_DISCIPLINE } from "@/lib/agent/planner"
import type { AgentExecutorDeps, AgentExecutorHooks, LlmHistoryMessage } from "@/lib/agent/executor-types"
import {
  buildGenModelForActiveProvider,
  buildReasoningOutputTokenBudget,
  consumeStreamTextOutput,
  keyForActiveProvider,
  llmCallSettings,
  logLlmCallFailure,
  normalizeModelId,
  providerSelfIntro,
  type StreamTextCallExtras,
} from "@/lib/agent/llm-utils"

export type DirectChatContext = {
  deps: AgentExecutorDeps
  hooks: Pick<AgentExecutorHooks, "onDirectChatStart" | "onDirectChatStream" | "onStreamFlush">
  userInput: string
  buildConversationMessages: (currentUserInput: string, currentUserContent: string) => LlmHistoryMessage[]
  runtimeKeys: AgentExecutorDeps["runtimeKeys"] | undefined
  inference: { temperature?: number; maxTokens?: number }
}

/** 直连对话：无工具、无拓扑；流式正文经 onDirectChatStream 回传。 */
export async function streamDirectChat(ctx: DirectChatContext): Promise<string> {
  const { deps, hooks, userInput, buildConversationMessages, runtimeKeys, inference } = ctx
  const active = deps.activeProvider
  const apiKey = (keyForActiveProvider(runtimeKeys, active.providerId) ?? "").trim()
  normalizeModelId(active.providerId, active.model)

  let model
  if (active.providerId === "ollama") {
    model = buildGenModelForActiveProvider(active, runtimeKeys)
  } else {
    if (!apiKey) throw new Error("MissingApiKey")
    model = buildGenModelForActiveProvider(active, runtimeKeys)
  }

  const sys = [
    providerSelfIntro(active),
    "",
    "当前为 DIRECT_CHAT 模式：无子任务拓扑、不要输出 JSON 任务数组或 ```json 围栏。",
    "messages 含完整对话历史；请结合上一轮 assistant 内容回答（如用户要求总结上一篇论文）。",
    "用自然中文简洁回答用户即可。",
    "",
    ACADEMIC_OUTPUT_DISCIPLINE,
  ].join("\n")

  hooks.onDirectChatStart?.()

  const chatMessages = buildConversationMessages(userInput, userInput.trim())
  const llmOpts = llmCallSettings(deps.signal)

  let streamed: Awaited<ReturnType<typeof streamText>>
  try {
    streamed = await streamText({
      model,
      temperature: Math.min(0.72, (inference.temperature ?? 0.45) + 0.12),
      system: sys,
      messages: chatMessages,
      ...llmOpts,
      maxOutputTokens: buildReasoningOutputTokenBudget(inference.maxTokens),
      ...({ experimental_continueOnLimit: true } satisfies StreamTextCallExtras),
      onFinish: () => {
        hooks.onStreamFlush?.({ reason: "stream-finished" })
      },
      onError: ({ error }) => {
        logLlmCallFailure("streamDirectChat: onError", error)
      },
    })
  } catch (e) {
    logLlmCallFailure("streamDirectChat: streamText failed", e)
    throw e
  }

  return consumeStreamTextOutput(
    streamed,
    (text) => {
      hooks.onDirectChatStream?.(text)
    },
    deps.signal
  )
}
