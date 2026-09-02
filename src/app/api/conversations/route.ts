import { auth } from "@/auth"
import { createAgentJob, markAgentJobRunning, updateAgentJobCheckpoint } from "@/lib/agent-jobs"
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import { conversationOwnerWhere, resolveUserIdFromRequest } from "@/lib/auth-user"
import { prisma } from "@/lib/prisma"
import { isAuthEnabled } from "@/lib/session-auth"
import {
  buildTemplateWorkflowNodes,
  getTemplateById,
  parseTemplateIdFromBody,
  validateTemplateCreateBody,
} from "@/lib/template-hub"

function parseLimit(raw: string | null, fallback = 50, max = 100) {
  const n = raw ? Number.parseInt(raw, 10) : fallback
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(max, Math.floor(n))
}

export async function GET(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)
  try {
    const url = new URL(req.url)
    const paginate = url.searchParams.has("limit") || url.searchParams.has("cursor")
    const limit = parseLimit(url.searchParams.get("limit"))
    const cursor = url.searchParams.get("cursor")?.trim() || undefined

    const conversations = await prisma.conversation.findMany({
      where: conversationOwnerWhere(userId),
      orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }],
      ...(paginate ? { take: limit + 1 } : {}),
      ...(paginate && cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        title: true,
        isPinned: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    if (!paginate) {
      return jsonOk(conversations)
    }

    const hasMore = conversations.length > limit
    const items = hasMore ? conversations.slice(0, limit) : conversations
    return jsonOk({
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      hasMore,
    })
  } catch (e) {
    console.error("[GET /api/conversations]", e)
    return jsonError("Failed to list conversations", 500)
  }
}

export async function POST(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)
  try {
    const session = isAuthEnabled() ? await auth() : null
    const existingUser = await prisma.user.findUnique({ where: { id: userId } })
    if (!existingUser) {
      await prisma.user.upsert({
        where: { id: userId },
        update: {},
        create: {
          id: userId,
          email: session?.user?.email || `${userId}@placeholder.com`,
          name: session?.user?.name || "Academic User",
        },
      })
    }

    const body = await parseJsonBody<unknown>(req).catch(() => null)
    const rawTemplateId = parseTemplateIdFromBody(body)
    if (rawTemplateId && !getTemplateById(rawTemplateId)) {
      return jsonError("Unknown templateId", 400)
    }
    const templateBody = validateTemplateCreateBody(body)
    const template = templateBody ? getTemplateById(templateBody.templateId) : null

    const conversation = await prisma.conversation.create({
      data: { title: template?.title ?? "新对话", userId },
      select: {
        id: true,
        title: true,
        isPinned: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    if (!template) {
      return jsonOk(conversation, { status: 201 })
    }

    const initialAgents = buildTemplateWorkflowNodes(template)
    const job = await createAgentJob(userId, {
      userInput: templateBody?.initialInput ?? template.title,
      provider: { providerId: "ollama", model: "llama3.1" },
    })
    await markAgentJobRunning(job.id)
    await updateAgentJobCheckpoint(job.id, {
      phase: "running",
      nodes: initialAgents,
      partialResults: [{ templateId: template.id, systemPrompt: template.systemPrompt }],
    })

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "system",
        content: template.systemPrompt,
        metadata: { templateId: template.id, jobId: job.id },
      },
    })

    if (templateBody?.initialInput?.trim()) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "user",
          content: templateBody.initialInput.trim(),
          metadata: { templateId: template.id },
        },
      })
    }

    return jsonOk(
      {
        ...conversation,
        templateBootstrap: {
          templateId: template.id,
          systemPrompt: template.systemPrompt,
          initialAgents,
          jobId: job.id,
        },
      },
      { status: 201 }
    )
  } catch (e) {
    console.error("[POST /api/conversations]", e)
    return jsonError("Failed to create conversation", 500)
  }
}
