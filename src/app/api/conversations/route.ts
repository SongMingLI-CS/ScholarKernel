import { jsonError, jsonOk } from "@/lib/api-utils"
import { conversationOwnerWhere, resolveUserId } from "@/lib/auth-user"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const userId = resolveUserId()
  try {
    const conversations = await prisma.conversation.findMany({
      where: conversationOwnerWhere(userId),
      orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        isPinned: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return jsonOk(conversations)
  } catch (e) {
    console.error("[GET /api/conversations]", e)
    return jsonError("Failed to list conversations", 500)
  }
}

export async function POST() {
  const userId = resolveUserId()
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
