import type { WorkflowNode, WorkflowStatus } from "@/lib/agent/planner"
import { dagNodeFingerprints } from "@/lib/agent/dag-fingerprint"
import { validateWorkflowDag } from "@/lib/agent/dag-validator"
import type { DagEventPublisher } from "@/lib/agent/event-publisher"
import type { DagNodeRunner, DagNodeRunResult } from "@/lib/agent/node-runner"

export type DagNodeState = {
  node: WorkflowNode
  status: WorkflowStatus
  output?: unknown
  error?: string
  errorCategory?: string
  attemptCount: number
  inputHash: string
  upstreamResultHash: string
  idempotencyKey: string
  startedAt?: Date
  completedAt?: Date
}

export type DagPersistence = (state: DagNodeState) => Promise<void>

export type DagScheduleResult = {
  states: Map<string, DagNodeState>
  outputs: Record<string, unknown>
  cancelled: boolean
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")) }, { once: true })
  })
}

function category(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled"
  if (error instanceof Error && error.message.startsWith("NodeTimeout:")) return "timeout"
  return "execution"
}

function linkAbort(parent?: AbortSignal): AbortController {
  const controller = new AbortController()
  if (parent?.aborted) controller.abort(parent.reason)
  else parent?.addEventListener("abort", () => controller.abort(parent.reason), { once: true })
  return controller
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal): Promise<T> {
  const controller = linkAbort(parent)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error(`NodeTimeout:${timeoutMs}`)) }, timeoutMs)
  })
  try {
    return await Promise.race([operation(controller.signal), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function scheduleWorkflowDag(input: {
  nodes: WorkflowNode[]
  runner: DagNodeRunner
  fallbackRunner?: DagNodeRunner
  concurrency?: number
  signal?: AbortSignal
  persist?: DagPersistence
  publish?: DagEventPublisher
  reusableStates?: Map<string, DagNodeState>
}): Promise<DagScheduleResult> {
  validateWorkflowDag(input.nodes)
  const concurrency = Math.max(1, Math.floor(input.concurrency ?? 3))
  const states = new Map<string, DagNodeState>()
  const outputs: Record<string, unknown> = {}
  let failFast = false

  const persist = async (state: DagNodeState) => { states.set(state.node.id, state); await input.persist?.(state) }
  const publish = async (nodeId: string, patch: Partial<WorkflowNode>) => input.publish?.({ type: "node", nodeId, patch })

  for (const node of input.nodes) states.set(node.id, { node, status: "pending", attemptCount: 0, ...dagNodeFingerprints(node.input, {}) })
  let restored = true
  while (restored) {
    restored = false
    for (const node of input.nodes) {
      if (states.get(node.id)?.status !== "pending") continue
      const dependencies = node.dependsOn ?? []
      if (!dependencies.every((id) => states.get(id)?.status === "done")) continue
      const upstream = Object.fromEntries(dependencies.map((id) => [id, outputs[id]]))
      const fingerprints = dagNodeFingerprints(node.input, upstream)
      const reusable = input.reusableStates?.get(node.id)
      if (reusable?.status === "done" && reusable.inputHash === fingerprints.inputHash && reusable.upstreamResultHash === fingerprints.upstreamResultHash) {
        states.set(node.id, reusable)
        outputs[node.id] = reusable.output
        restored = true
      } else {
        states.set(node.id, { node, status: "pending", attemptCount: 0, ...fingerprints })
      }
    }
  }

  const runNode = async (node: WorkflowNode) => {
    const dependencies = node.dependsOn ?? []
    const upstreamResults = Object.fromEntries(dependencies.map((id) => [id, outputs[id]]))
    const fingerprints = dagNodeFingerprints(node.input, upstreamResults)
    const retry = node.retryPolicy ?? { maxAttempts: 1, backoffMs: 0 }
    let lastError: unknown
    let attemptsMade = 0
    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
      if (input.signal?.aborted) break
      attemptsMade = attempt
      const running: DagNodeState = { node, status: "running", attemptCount: attempt, startedAt: new Date(), ...fingerprints }
      await persist(running)
      await publish(node.id, { status: "running" })
      try {
        const result = await withTimeout((signal) => input.runner(node, { attempt, upstreamResults, signal }), node.timeoutMs ?? 120_000, input.signal)
        const done: DagNodeState = { ...running, status: "done", output: result.output, completedAt: new Date() }
        outputs[node.id] = result.output
        await persist(done)
        await publish(node.id, { status: "done", output: result.output })
        return
      } catch (error) {
        lastError = error
        if (input.signal?.aborted) break
        if (attempt < retry.maxAttempts) await delay(retry.backoffMs * 2 ** (attempt - 1), input.signal ?? new AbortController().signal)
      }
    }
    if (node.failurePolicy === "fallback" && input.fallbackRunner && !input.signal?.aborted) {
      const fallbackAttempt = attemptsMade + 1
      const result: DagNodeRunResult = await input.fallbackRunner(node, { attempt: fallbackAttempt, upstreamResults, signal: input.signal ?? new AbortController().signal })
      outputs[node.id] = result.output
      const done: DagNodeState = { node, status: "done", output: result.output, attemptCount: fallbackAttempt, completedAt: new Date(), ...fingerprints }
      await persist(done)
      await publish(node.id, { status: "done", output: result.output, metadata: { ...node.metadata, fallback: true } })
      return
    }
    const aborted = input.signal?.aborted
    const message = lastError instanceof Error ? lastError.message : aborted ? "Aborted" : String(lastError ?? "NodeFailed")
    const failed: DagNodeState = { node, status: aborted ? "cancelled" : "error", error: message, errorCategory: category(lastError), attemptCount: attemptsMade, completedAt: new Date(), ...fingerprints }
    await persist(failed)
    await publish(node.id, { status: failed.status, error: message })
    if (node.failurePolicy === "fail-fast") failFast = true
  }

  while (states.size) {
    if (input.signal?.aborted || failFast) {
      for (const node of input.nodes) {
        const state = states.get(node.id)!
        if (state.status !== "pending") continue
        await persist({ ...state, status: "cancelled", error: input.signal?.aborted ? "Aborted" : "FailFastUpstream", errorCategory: "cancelled", completedAt: new Date() })
        await publish(node.id, { status: "cancelled" })
      }
      break
    }
    const pending = input.nodes.filter((node) => states.get(node.id)?.status === "pending")
    if (!pending.length) break
    const ready = pending.filter((node) => (node.dependsOn ?? []).every((id) => {
      const dependency = states.get(id)
      if (dependency?.status === "done") return true
      return dependency?.status === "error" && dependency.node.failurePolicy === "continue"
    }))
    if (!ready.length) {
      for (const node of pending) {
        const state = states.get(node.id)!
        await persist({ ...state, status: "cancelled", error: "UnsatisfiedDependency", errorCategory: "dependency", completedAt: new Date() })
      }
      break
    }
    for (let offset = 0; offset < ready.length; offset += concurrency) {
      if (input.signal?.aborted || failFast) break
      await Promise.all(ready.slice(offset, offset + concurrency).map(runNode))
    }
  }

  return { states, outputs, cancelled: Boolean(input.signal?.aborted || failFast) }
}
