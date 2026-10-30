import { z } from "zod"
import { jsonError, jsonOk } from "@/lib/api-utils"
import { createDurableJob } from "./durable-jobs"

const schema = z.object({
  userInput: z.string().trim().min(1).max(200_000),
  provider: z.object({ providerId: z.enum(["openai", "anthropic", "google", "deepseek_openai_compat", "ollama"]), model: z.string().min(1).max(200), baseUrl: z.string().max(2000).optional() }),
  chatHistory: z.array(z.object({ role: z.enum(["user", "assistant", "system"]), content: z.string().max(100_000) })).max(40).optional(),
  inference: z.object({ temperature: z.number().min(0).max(2).optional(), maxTokens: z.number().int().min(1).max(8192).optional(), contextLimit: z.number().int().min(512).max(128000).optional() }).optional(),
  localOnly: z.boolean().optional(), planRetryMessage: z.string().max(8000).optional(),
  conversationId: z.string().max(200).optional(), assistantMessageId: z.string().max(200).optional(),
})
export async function createDurableJobResponse(userId: string, body: unknown) {
  if (process.env.AGENT_DURABLE_JOBS !== "1") return jsonError("DurableJobsDisabled: 请先启用独立 Worker", 503)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return jsonError("Invalid durable Job configuration", 400)
  const job = await createDurableJob(userId, parsed.data)
  return jsonOk(job, { status: 202 })
}
