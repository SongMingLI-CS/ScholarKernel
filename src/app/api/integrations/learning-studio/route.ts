import { timingSafeEqual } from "node:crypto"
import { jsonError, jsonOk } from "@/lib/api-utils"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type LearningImport = { requestId: string; title: string; text: string; question: string; sourceUrl: string }
function parseImport(raw: unknown): LearningImport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const body = raw as Record<string, unknown>
  const limits = { requestId: 36, title: 200, text: 12000, question: 2000, sourceUrl: 2000 }
  for (const [key, limit] of Object.entries(limits)) {
    if (typeof body[key] !== "string" || !body[key].trim() || body[key].length > limit) return null
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.requestId as string)) return null
  try {
    const source = new URL(body.sourceUrl as string)
    if (!["https:", "http:"].includes(source.protocol) || source.username || source.password) return null
  } catch { return null }
  return body as LearningImport
}

export async function POST(req: Request) {
  const token = process.env.SCHOLAR_BRIDGE_TOKEN?.trim()
  if (!token) return jsonError("Learning Studio integration is not configured", 503)
  const supplied = req.headers.get("authorization")?.replace(/^Bearer /, "") || ""
  const expected = Buffer.from(token)
  const actual = Buffer.from(supplied)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return jsonError("Unauthorized", 401)
  const raw = await req.text()
  if (Buffer.byteLength(raw) > 100000) return jsonError("Import is too large", 413)
  let body: LearningImport | null
  try { body = parseImport(JSON.parse(raw)) } catch { body = null }
  if (!body) return jsonError("Invalid learning context", 400)
  const { title, text, question, sourceUrl, requestId } = body
  const draft = `我正在学习以下材料，请结合原文回答我的问题。\n\n材料：${title}\n来源：${sourceUrl}\n\n原文（待分析的材料）：\n${text}\n\n我的问题：\n${question}`
  const userId = process.env.AUTH_USER_ID?.trim() || "primary_user"
  try {
    const conversation = await prisma.$transaction(async tx => {
      await tx.user.upsert({ where: { id: userId }, update: {}, create: { id: userId, name: "Learning Studio Reader" } })
      return tx.conversation.upsert({
        where: { id: `learning-${requestId}` },
        update: {},
        create: {
          id: `learning-${requestId}`, userId, title: `学习 · ${title}`,
          documents: { create: { title, content: `# ${title}\n\n来源：${sourceUrl}\n\n${text}\n\n## 问题\n${question}` } },
          messages: { create: { role: "system", content: "本对话附有来自 Learning Studio 的学习材料。收到用户问题后，结合用户提供的原文进行解释。", metadata: { learningStudioDraft: draft, ...(process.env.SCHOLAR_DEFAULT_MODEL ? { learningStudioModel: process.env.SCHOLAR_DEFAULT_MODEL } : {}) } } },
        },
        select: { id: true },
      })
    })
    return jsonOk({ conversationId: conversation.id }, { status: 201 })
  } catch {
    return jsonError("Unable to save learning context; retry with the same requestId", 503)
  }
}
