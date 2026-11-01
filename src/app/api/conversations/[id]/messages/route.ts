import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import { conversationOwnerWhere, resolveUserIdFromRequest } from "@/lib/auth-user"
import type { CreateMessageBody } from "@/lib/db-types"
import { prisma } from "@/lib/prisma"
import { normalizeSources } from "@/lib/source-metadata"

type RouteCtx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteCtx) {
  const { id: conversationId } = await ctx.params
  const body = await parseJsonBody<CreateMessageBody>(req)

  if (!body?.role || typeof body.content !== "string") {
    return jsonError("Invalid message body", 400)
  }

  const role = body.role
  if (role !== "user" && role !== "assistant" && role !== "system") {
    return jsonError("Invalid message role", 400)
  }

  try {
    const userId = await resolveUserIdFromRequest(req)
    if (!userId) return jsonError("Unauthorized", 401)
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, ...conversationOwnerWhere(userId) },
      select: { id: true },
    })
    if (!conversation) return jsonError("Conversation not found", 404)

    const messageId = body.id?.trim() || undefined
    // body.metadata 是客户端输入，原来只判了 typeof 就原样落库：
    // `sources[].url = "javascript:..."` 会被存进 message.metadata，
    // 前端 SourcesFoldout 直接拿它当 `<a href>`。写库前按协议白名单清洗，
    // 与读库路径（parseMessageMetadata）共用同一实现。
    const sources = normalizeSources(
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? (body.metadata as { sources?: unknown }).sources
        : undefined
    )
    const metadata = sources.length ? { sources } : undefined

    // 归属校验只覆盖了 conversationId，管不到 messageId。
    // 而下面 upsert 的 `where: { id: messageId }` 只按主键定位 —— 不校验的话，
    // 攻击者拿任意一个自己拥有的会话，把别人的 message id 传进来，
    // update 分支就会改写那条消息的 role/content（跨租户越权写）。
    if (messageId) {
      const existing = await prisma.message.findUnique({
        where: { id: messageId },
        select: { conversationId: true },
      })
      if (existing && existing.conversationId !== conversationId) {
        return jsonError("Message id already in use", 409)
      }
    }

    const [message] = await prisma.$transaction([
      messageId
        ? prisma.message.upsert({
            where: { id: messageId },
            create: {
              id: messageId,
              conversationId,
              role,
              content: body.content,
              ...(metadata ? { metadata } : {}),
            },
            update: {
              content: body.content,
              role,
              ...(metadata !== undefined ? { metadata } : {}),
            },
          })
        : prisma.message.create({
            data: {
              conversationId,
              role,
              content: body.content,
              ...(metadata ? { metadata } : {}),
            },
          }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      }),
    ])

    return jsonOk(message, { status: 201 })
  } catch (e) {
    console.error("[POST /api/conversations/[id]/messages]", e)
    return jsonError("Failed to append message", 500)
  }
}

export async function DELETE(req: Request, ctx: RouteCtx) {
  const { id: conversationId } = await ctx.params

  try {
    const userId = await resolveUserIdFromRequest(req)
    if (!userId) return jsonError("Unauthorized", 401)
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, ...conversationOwnerWhere(userId) },
      select: { id: true },
    })
    if (!conversation) return jsonError("Conversation not found", 404)

    await prisma.$transaction([
      prisma.message.deleteMany({ where: { conversationId } }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      }),
    ])

    return new Response(null, { status: 204 })
  } catch (e) {
    console.error("[DELETE /api/conversations/[id]/messages]", e)
    return jsonError("Failed to clear messages", 500)
  }
}
