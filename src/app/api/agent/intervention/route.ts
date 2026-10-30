import { resolveUserIdFromRequest } from "@/lib/auth-user"
import { prisma } from "@/lib/prisma"
import { applyOwnedIntervention, InterventionError } from "@/lib/agent/intervention-service"
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"

type InterventionBody = { sessionId?: string; jobId?: string; nodeId?: string; action?: "approve" | "redirect"; instruction?: string }

export async function POST(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)
  const body = await parseJsonBody<InterventionBody>(req)
  const jobId = body?.jobId?.trim() || body?.sessionId?.trim()
  const nodeId = body?.nodeId?.trim()
  if (!jobId || !nodeId || (body?.sessionId && body.sessionId !== jobId) || (body?.action !== "approve" && body?.action !== "redirect")) return jsonError("Job, node and action required", 400)
  const instruction = body.instruction?.trim() ?? ""
  if (body.action === "redirect" && (!instruction || instruction.length > 8000)) return jsonError("Redirect instruction must contain 1–8000 characters", 400)
  try {
    const decision = body.action === "redirect" ? { action: "redirect" as const, instruction } : { action: "approve" as const }
    return jsonOk(await applyOwnedIntervention(userId, jobId, nodeId, decision))
  } catch (error) {
    if (error instanceof InterventionError) return jsonError(error.message, error.status)
    return jsonError("Unable to save intervention decision", 500)
  }
}

export async function GET(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)
  const jobId = new URL(req.url).searchParams.get("sessionId")?.trim()
  if (!jobId) return jsonError("Job id required", 400)
  const job = await prisma.agentJob.findFirst({ where: { id: jobId, userId } })
  if (!job) return jsonError("Job not found", 404)
  const checkpoint = job.checkpoint as { humanInterventionPending?: { nodeId: string; reason: string; at: number } } | null
  const pending = job.status === "running" || job.status === "waiting_for_input" ? checkpoint?.humanInterventionPending : null
  return jsonOk(pending ? { pending: true, nodeId: pending.nodeId, reason: pending.reason, createdAt: pending.at } : { pending: false })
}
