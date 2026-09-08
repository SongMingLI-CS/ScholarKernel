import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import { resolveUserIdFromRequest } from "@/lib/auth-user"
import { configuredEmbeddingProvider } from "@/lib/embedding-provider"
import { selectLibraryMaintenanceBatch } from "@/lib/library-index-maintenance"
import { scheduleLibraryIndexJob } from "@/lib/library-index-job"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function boundedLimit(value: unknown, fallback = 10): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(50, Math.floor(parsed))) : fallback
}

async function maintenanceCandidates(userId: string) {
  return prisma.document.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, indexStatus: true, indexJobId: true, fileHash: true,
      parserVersion: true, chunkVersion: true, embeddingModelVersion: true, embeddingStatus: true,
    },
  })
}

export async function GET(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)
  const documents = await maintenanceCandidates(userId)
  const model = configuredEmbeddingProvider()?.modelVersion ?? null
  const limit = boundedLimit(new URL(req.url).searchParams.get("limit"))
  const stale = selectLibraryMaintenanceBatch(documents, model, limit)
  return jsonOk({ staleDocumentIds: stale.map((document) => document.id), totalScanned: documents.length })
}

export async function POST(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)
  const body = await parseJsonBody<{ limit?: number }>(req)
  const limit = boundedLimit(body?.limit)
  const documents = await maintenanceCandidates(userId)
  const model = configuredEmbeddingProvider()?.modelVersion ?? null
  const stale = selectLibraryMaintenanceBatch(documents, model, limit)
  const scheduled: Array<{ documentId: string; indexJobId: string }> = []
  for (const document of stale) {
    scheduled.push({ documentId: document.id, indexJobId: await scheduleLibraryIndexJob(userId, document.id) })
  }
  const totalStale = documents.filter((document) => selectLibraryMaintenanceBatch([document], model, 1).length > 0).length
  return jsonOk({ scheduled, remainingStale: Math.max(0, totalStale - scheduled.length) }, { status: 202 })
}
