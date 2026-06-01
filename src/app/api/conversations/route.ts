import { jsonError, jsonOk } from "@/lib/api-utils"
import { conversationOwnerWhere, resolveUserIdFromRequest } from "@/lib/auth-user"
import { prisma } from "@/lib/prisma"

function parseLimit(raw: string | null, fallback = 50, max = 100) {
  const n = raw ? Number.parseInt(raw, 10) : fallback
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(max, Math.floor(n))
}

export async function GET(req: Request) {
  const userId = resolveUserIdFromRequest(req)
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
  const userId = resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)
  try {
    const conversation = await prisma.conversation.create({
      data: { title: "新对话", userId },
      select: {
        id: true,
        title: true,
        isPinned: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return jsonOk(conversation, { status: 201 })
  } catch (e) {
    console.error("[POST /api/conversations]", e)
    return jsonError("Failed to create conversation", 500)
  }
}
