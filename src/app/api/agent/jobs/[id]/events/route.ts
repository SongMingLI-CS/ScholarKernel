import { resolveUserIdFromRequest } from "@/lib/auth-user"
import { prisma } from "@/lib/prisma"
import { jsonError } from "@/lib/api-utils"
import { readJobEvents, TERMINAL_JOB_STATES } from "@/lib/agent/durable-jobs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
type Context = { params: Promise<{ id: string }> }
export async function GET(req: Request, context: Context) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)
  const { id } = await context.params
  const job = await prisma.agentJob.findFirst({ where: { id, userId, executionMode: "durable" }, select: { id: true } })
  if (!job) return jsonError("Job not found", 404)
  const cursorText = req.headers.get("last-event-id")?.split(":").at(-1) ?? new URL(req.url).searchParams.get("after") ?? "0"
  let after = Number(cursorText)
  if (!Number.isSafeInteger(after) || after < 0) return jsonError("Invalid event cursor", 400)
  const encoder = new TextEncoder()
  let stopped = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => { if (!stopped) controller.enqueue(encoder.encode(text)) }
      const deadline = Date.now() + 25_000
      try {
        send("retry: 1000\n\n")
        while (!stopped && !req.signal.aborted && Date.now() < deadline) {
          const events = await readJobEvents(userId, id, after)
          for (const event of events) {
            send(`id: ${id}:${event.sequence}\ndata: ${JSON.stringify({ id: event.id, sequence: event.sequence, type: event.type, payload: event.payload })}\n\n`)
            after = event.sequence
          }
          const state = await prisma.agentJob.findFirst({ where: { id, userId }, select: { status: true, eventSequence: true } })
          if (!state || (TERMINAL_JOB_STATES.has(state.status) && after >= state.eventSequence)) break
          if (events.length === 100) continue
          send(": heartbeat\n\n")
          await new Promise(resolve => setTimeout(resolve, 750))
        }
      } catch { if (!stopped) send(`event: stream_error\ndata: ${JSON.stringify({ error: "EventStreamUnavailable" })}\n\n`) }
      finally { if (!stopped) { stopped = true; controller.close() } }
    },
    cancel() { stopped = true },
  })
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } })
}
