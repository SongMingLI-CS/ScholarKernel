import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import { resolveUserIdFromRequest } from "@/lib/auth-user"
import { configuredEmbeddingProvider } from "@/lib/embedding-provider"
import {
  libraryDocumentNeedsMaintenance,
  type LibraryIndexMaintenanceCandidate,
} from "@/lib/library-index-maintenance"
import { scheduleLibraryIndexJob } from "@/lib/library-index-job"
import { isLibraryMaintenanceAdmin } from "@/lib/library-maintenance-admin"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type AdminMaintenanceCandidate = LibraryIndexMaintenanceCandidate & { userId: string }

function boundedLimit(value: unknown, fallback = 10): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(50, Math.floor(parsed))) : fallback
}

function normalizedCursor(value: unknown): string | null {
  if (typeof value !== "string") return null
  const cursor = value.trim()
  return cursor && cursor.length <= 256 ? cursor : null
}

async function maintenanceCandidates(limit: number, cursor: string | null) {
  return prisma.document.findMany({
    orderBy: { id: "asc" },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: Math.min(500, limit * 10),
    select: {
      id: true, userId: true, indexStatus: true, indexJobId: true, fileHash: true,
      parserVersion: true, chunkVersion: true, embeddingModelVersion: true, embeddingStatus: true,
    },
  })
}

function inspectPage(
  documents: AdminMaintenanceCandidate[],
  embeddingModelVersion: string | null,
  limit: number
) {
  const stale: AdminMaintenanceCandidate[] = []
  let scanned = 0
  for (const document of documents) {
    scanned += 1
    if (libraryDocumentNeedsMaintenance(document, embeddingModelVersion)) stale.push(document)
    if (stale.length === limit) break
  }
  const nextCursor = scanned > 0 ? documents[scanned - 1].id : null
  const scanWindow = Math.min(500, limit * 10)
  const hasMore = scanned < documents.length || documents.length === scanWindow
  return { stale, scanned, nextCursor, hasMore }
}

type AuthorizationResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response }

async function authorize(req: Request): Promise<AuthorizationResult> {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return { ok: false, response: jsonError("Unauthorized", 401) }
  if (!isLibraryMaintenanceAdmin(userId)) return { ok: false, response: jsonError("Forbidden", 403) }
  return { ok: true, userId }
}

export async function GET(req: Request) {
  const authorization = await authorize(req)
  if (!authorization.ok) return authorization.response
  const search = new URL(req.url).searchParams
  const limit = boundedLimit(search.get("limit"))
  const documents = await maintenanceCandidates(limit, normalizedCursor(search.get("cursor")))
  const model = configuredEmbeddingProvider()?.modelVersion ?? null
  const page = inspectPage(documents, model, limit)
  return jsonOk({
    staleDocumentIds: page.stale.map((document) => document.id),
    scanned: page.scanned,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  })
}

export async function POST(req: Request) {
  const authorization = await authorize(req)
  if (!authorization.ok) return authorization.response
  const body = await parseJsonBody<{ limit?: number; cursor?: string }>(req)
  const limit = boundedLimit(body?.limit)
  const documents = await maintenanceCandidates(limit, normalizedCursor(body?.cursor))
  const model = configuredEmbeddingProvider()?.modelVersion ?? null
  const page = inspectPage(documents, model, limit)
  const scheduled: Array<{ documentId: string; indexJobId: string }> = []
  for (const document of page.stale) {
    scheduled.push({
      documentId: document.id,
      indexJobId: await scheduleLibraryIndexJob(document.userId, document.id),
    })
  }
  return jsonOk({
    scheduled,
    scanned: page.scanned,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  }, { status: 202 })
}
