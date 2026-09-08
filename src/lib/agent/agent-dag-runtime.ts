import { AgentExecutor } from "@/lib/agent-executor"
import type { AgentExecutorDeps, AgentExecutorHooks } from "@/lib/agent/executor-types"
import { scheduleWorkflowDag } from "@/lib/agent/dag-scheduler"
import { dagNodeFingerprints } from "@/lib/agent/dag-fingerprint"
import { normalizeLegacyWorkflowDag, validateWorkflowDag } from "@/lib/agent/dag-validator"
import { hookDagEventPublisher } from "@/lib/agent/event-publisher"
import { persistDagNodeStateAtomically } from "@/lib/agent/dag-persistence"
import { executePeerReviewGroup, executePeerReviewerDagNode } from "@/lib/agent/peer-review-runner"
import type { PeerReviewCheckpointData } from "@/lib/agent/peer-review-checkpoint"
import type { WorkflowNode } from "@/lib/agent/planner"
import type { AcademicSearchHit } from "@/lib/tools/search-tool"
import type { DagNodeRunner } from "@/lib/agent/node-runner"

function textFromOutput(output: unknown): string {
  if (typeof output === "string") return output
  if (!output || typeof output !== "object") return ""
  const record = output as Record<string, unknown>
  if (typeof record.finalResponse === "string") return record.finalResponse
  if (typeof record.text === "string") return record.text
  return JSON.stringify(output)
}

function upstreamHistory(outputs: Record<string, unknown>) {
  return Object.entries(outputs).map(([nodeId, output]) => ({
    role: "assistant" as const,
    content: `[DAG upstream ${nodeId}]\n${textFromOutput(output)}`,
  }))
}

export async function runAgentWorkflowDag(input: {
  executor: AgentExecutor
  userInput: string
  deps: AgentExecutorDeps
  hooks?: AgentExecutorHooks
  resumeNodes?: WorkflowNode[]
  concurrency?: number
  planRetryMessage?: string
  nodeRunner?: DagNodeRunner
}): Promise<{ final: string; nodes: WorkflowNode[]; sources: AcademicSearchHit[] }> {
  let nodes = input.resumeNodes?.length ? input.resumeNodes : await input.executor.plan(input.userInput, input.planRetryMessage ? { retryMessage: input.planRetryMessage } : undefined)
  nodes = normalizeLegacyWorkflowDag(nodes)
  validateWorkflowDag(nodes)
  if (input.resumeNodes?.length) input.hooks?.onWorkflowPlanned?.(nodes)
  const sourceMap = new Map<string, AcademicSearchHit>()
  const finalByNode = new Map<string, string>()
  const peerNodes = nodes.filter((node) => node.type === "peer_review")
  const methodologyNode = peerNodes.find((node) => node.metadata?.personaId === "methodology_critic")
    ?? peerNodes.find((node) => node.metadata?.peerReviewRole === "reviewer")
  const innovationNode = peerNodes.find((node) => node.metadata?.personaId === "innovation_scout")
    ?? peerNodes.find((node) => node.metadata?.peerReviewRole === "reviewer" && node.id !== methodologyNode?.id)
  const metaReviewNode = peerNodes.find((node) => node.metadata?.peerReviewRole === "meta_review")
  const orderedPeerGroup = [methodologyNode, innovationNode, metaReviewNode].filter((node): node is WorkflowNode => Boolean(node))
  const publish = hookDagEventPublisher(input.hooks ?? {})
  let stateSnapshot: import("@/lib/agent/dag-scheduler").DagNodeState[] = []
  const reusableStates = new Map<string, import("@/lib/agent/dag-scheduler").DagNodeState>()
  const forcedInvalidation = new Set<string>()
  if (input.deps.targetNodeId) {
    forcedInvalidation.add(input.deps.targetNodeId)
    let changed = true
    while (changed) {
      changed = false
      for (const node of nodes) {
        if (!forcedInvalidation.has(node.id) && (node.dependsOn ?? []).some((id) => forcedInvalidation.has(id))) {
          forcedInvalidation.add(node.id)
          changed = true
        }
      }
    }
  }
  for (const snapshot of input.deps.resumeSnapshots ?? []) {
    const node = nodes.find((item) => item.id === snapshot.nodeId)
    if (!node || forcedInvalidation.has(node.id) || snapshot.status !== "done" || !snapshot.inputHash || !snapshot.upstreamResultHash || !snapshot.idempotencyKey) continue
    reusableStates.set(node.id, {
      node, status: "done", output: snapshot.outputs, attemptCount: snapshot.attemptCount ?? 1,
      inputHash: snapshot.inputHash, upstreamResultHash: snapshot.upstreamResultHash, idempotencyKey: snapshot.idempotencyKey,
      startedAt: snapshot.startedAt, completedAt: snapshot.completedAt,
    })
  }
  stateSnapshot = nodes.map((node) => reusableStates.get(node.id) ?? {
    node,
    status: "pending",
    attemptCount: 0,
    ...dagNodeFingerprints(node.input, {}),
  })

  const scheduled = await scheduleWorkflowDag({
    nodes,
    concurrency: input.concurrency ?? Number(process.env.AGENT_DAG_CONCURRENCY || 3),
    signal: input.deps.signal,
    reusableStates,
    publish,
    persist: input.deps.jobId
      ? async (state) => {
          const next = [...stateSnapshot.filter((item) => item.node.id !== state.node.id), state]
          stateSnapshot = next
          await persistDagNodeStateAtomically(input.deps.jobId!, state, next)
        }
      : undefined,
    fallbackRunner: async (node) => ({ output: { text: `Node ${node.id} failed; fallback policy allowed the workflow to continue.`, fallback: true } }),
    runner: async (node, context) => {
      if (input.nodeRunner) {
        const result = await input.nodeRunner(node, context)
        finalByNode.set(node.id, textFromOutput(result.output))
        return result
      }
      const role = node.metadata?.peerReviewRole
      if (node.type === "peer_review" && role === "reviewer") {
        const result = await executePeerReviewerDagNode({ node, userInput: input.userInput, deps: { ...input.deps, signal: context.signal }, hooks: input.hooks ?? {} })
        finalByNode.set(node.id, textFromOutput(result.output))
        return { output: result.output }
      }
      if (node.type === "peer_review" && role === "meta_review") {
        const methodologyReview = textFromOutput(context.upstreamResults[methodologyNode?.id ?? ""])
        const innovationReview = textFromOutput(context.upstreamResults[innovationNode?.id ?? ""])
        const checkpoint: PeerReviewCheckpointData = {
          version: 1,
          subject: input.userInput,
          methodologyReview,
          innovationReview,
          completedStages: ["r1", "r2"],
        }
        const results = await executePeerReviewGroup({
          groupNodes: orderedPeerGroup,
          userInput: input.userInput,
          deps: { ...input.deps, signal: context.signal },
          hooks: input.hooks ?? {},
          checkpoint,
          onCheckpoint: input.deps.onPeerReviewCheckpoint,
          allWorkflowNodes: nodes,
        })
        const result = results.find((item) => item.id === node.id) ?? results.at(-1)!
        finalByNode.set(node.id, textFromOutput(result.output))
        return { output: result.output }
      }

      const baseHistory = input.deps.getChatHistory?.() ?? []
      let terminalPatch: Partial<WorkflowNode> = {}
      const child = new AgentExecutor(
        {
          ...input.deps,
          signal: context.signal,
          resumeNodes: undefined,
          resumeSnapshots: undefined,
          onNodeSnapshotPersist: undefined,
          getChatHistory: () => [...baseHistory, ...upstreamHistory(context.upstreamResults)],
        },
        {
          ...input.hooks,
          onWorkflowPlanned: undefined,
          onNodePatch: (nodeId, patch) => {
            if (nodeId === node.id) terminalPatch = { ...terminalPatch, ...patch }
            input.hooks?.onNodePatch?.(nodeId, patch)
          },
        }
      )
      const isolatedNode = { ...node, dependsOn: [] }
      const result = await child.run(input.userInput, { resumeNodes: [isolatedNode] })
      const executed = { ...(result.nodes.find((item) => item.id === node.id) ?? result.nodes[0] ?? node), ...terminalPatch }
      if (executed.status === "error") throw new Error(executed.error ?? `NodeFailed:${node.id}`)
      for (const source of result.sources) sourceMap.set(source.url, source)
      finalByNode.set(node.id, result.final)
      return { output: executed.output ?? (node.type === "research" ? { text: result.final, results: result.sources } : { text: result.final }) }
    },
  })

  const finalNodes = nodes.map((node) => {
    const state = scheduled.states.get(node.id)
    return { ...node, status: state?.status ?? node.status, output: state?.output, error: state?.error }
  })
  const depended = new Set(nodes.flatMap((node) => node.dependsOn ?? []))
  const sink = nodes.find((node) => !depended.has(node.id)) ?? nodes.at(-1)
  const final = sink ? finalByNode.get(sink.id) || textFromOutput(scheduled.outputs[sink.id]) : ""
  return { final: final || "工作流已完成，但最终节点没有产生文本输出。", nodes: finalNodes, sources: [...sourceMap.values()] }
}
