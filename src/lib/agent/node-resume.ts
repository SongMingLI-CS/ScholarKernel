import type { ChatHistoryEntry } from "@/lib/agent/planner"
import type { SubtaskResult } from "@/lib/agent/executor-types"
import type { WorkflowNode } from "@/lib/agent/planner"
import type { AcademicSearchHit } from "@/lib/tools/search-tool"
import { asRecord } from "@/lib/agent/llm-utils"
import { formatResearchResultsForSessionContext } from "@/lib/agent/llm-utils"

/** 单节点持久化快照（DB AgentNode 或内存 workflow 均可映射为此结构）。 */
export type NodeSnapshotRecord = {
  nodeId: string
  status: "pending" | "running" | "done" | "error"
  outputs?: unknown
  nodeSnapshot?: NodeExecutionSnapshot
}

/** 节点执行时的完整上下文环境变量与依赖关系。 */
export type NodeExecutionSnapshot = {
  nodeType: WorkflowNode["type"]
  nodeIndex: number
  priorNodeIds: string[]
  subtaskResult?: SubtaskResult
  sources?: AcademicSearchHit[]
  citationsMarkdown?: string
  sessionContextDelta?: ChatHistoryEntry[]
  workflowNode?: WorkflowNode
}

export type ResumeExecutionState = {
  results: SubtaskResult[]
  sources: AcademicSearchHit[]
  citationsMarkdown: string
  sessionContextMessages: ChatHistoryEntry[]
}

export function findTargetNodeIndex(nodes: WorkflowNode[], targetNodeId: string): number {
  const idx = nodes.findIndex((n) => n.id === targetNodeId)
  if (idx < 0) throw new Error(`TargetNodeNotFound:${targetNodeId}`)
  return idx
}

export function shouldSkipNodeForResume(
  nodeIndex: number,
  targetIndex: number,
  snapshot: NodeSnapshotRecord | undefined
): boolean {
  return nodeIndex < targetIndex && snapshot?.status === "done"
}

export function extractFinalResponse(output: unknown): string | null {
  const rec = asRecord(output)
  if (typeof rec["finalResponse"] === "string") return String(rec["finalResponse"])
  if (typeof rec["text"] === "string") return String(rec["text"])
  return null
}

export function buildNodeSnapshotRecord(input: {
  node: WorkflowNode
  nodeIndex: number
  nodes: WorkflowNode[]
  subtaskResult: SubtaskResult
  sources: AcademicSearchHit[]
  citationsMarkdown: string
  sessionContextDelta?: ChatHistoryEntry[]
}): NodeSnapshotRecord {
  const { node, nodeIndex, nodes, subtaskResult, sources, citationsMarkdown, sessionContextDelta } = input
  return {
    nodeId: node.id,
    status: "done",
    outputs: subtaskResult.output ?? node.output,
    nodeSnapshot: {
      nodeType: node.type,
      nodeIndex,
      priorNodeIds: nodes.slice(0, nodeIndex).map((n) => n.id),
      subtaskResult,
      sources: [...sources],
      citationsMarkdown,
      sessionContextDelta: sessionContextDelta ? [...sessionContextDelta] : undefined,
      workflowNode: { ...node, status: "done", output: subtaskResult.output ?? node.output },
    },
  }
}

export function snapshotsFromWorkflowNodes(nodes: WorkflowNode[]): NodeSnapshotRecord[] {
  return nodes
    .filter((n) => n.status === "done" && n.output != null)
    .map((n) => {
      const nodeIndex = nodes.findIndex((x) => x.id === n.id)
      const priorNodeIds = nodes.slice(0, nodeIndex).map((x) => x.id)
      return {
        nodeId: n.id,
        status: "done" as const,
        outputs: n.output,
        nodeSnapshot: {
          nodeType: n.type,
          nodeIndex,
          priorNodeIds,
          subtaskResult: {
            id: n.id,
            ok: true,
            summary: `restored:${n.type}`,
            output: n.output,
          },
          workflowNode: n,
        },
      }
    })
}

export function snapshotMap(records: NodeSnapshotRecord[]): Map<string, NodeSnapshotRecord> {
  return new Map(records.map((r) => [r.nodeId, r]))
}

/** 从已完成节点快照汇聚 execution state，供断点续跑注入 executor 内存。 */
export function restoreExecutionStateFromSnapshots(
  snapshots: NodeSnapshotRecord[],
  nodes: WorkflowNode[],
  targetNodeId: string
): ResumeExecutionState {
  const targetIndex = findTargetNodeIndex(nodes, targetNodeId)
  const byId = snapshotMap(snapshots)
  const results: SubtaskResult[] = []
  let sources: AcademicSearchHit[] = []
  let citationsMarkdown = ""
  const sessionContextMessages: ChatHistoryEntry[] = []

  for (let i = 0; i < targetIndex; i++) {
    const n = nodes[i]!
    const snap = byId.get(n.id)
    if (snap?.status !== "done") continue

    const ctx = snap.nodeSnapshot
    if (ctx?.subtaskResult) {
      results.push(ctx.subtaskResult)
    } else if (snap.outputs != null) {
      results.push({
        id: n.id,
        ok: true,
        summary: `restored:${n.type}`,
        output: snap.outputs,
      })
    }

    if (ctx?.sources?.length) {
      sources = ctx.sources
    }
    if (typeof ctx?.citationsMarkdown === "string" && ctx.citationsMarkdown) {
      citationsMarkdown = ctx.citationsMarkdown
    }
    if (ctx?.sessionContextDelta?.length) {
      sessionContextMessages.push(...ctx.sessionContextDelta)
    } else if (n.type === "research" && snap.outputs) {
      const out = asRecord(snap.outputs)
      if (Array.isArray(out["results"])) {
        const block = formatResearchResultsForSessionContext(
          snap.outputs as Parameters<typeof formatResearchResultsForSessionContext>[0],
          citationsMarkdown
        )
        sessionContextMessages.push({ role: "assistant", content: block })
      }
    }
  }

  return { results, sources, citationsMarkdown, sessionContextMessages }
}

/** 断点续跑：将 target 及下游 error 节点重置为 pending。 */
export function prepareNodesForPartialResume(nodes: WorkflowNode[], targetNodeId: string): WorkflowNode[] {
  const targetIndex = findTargetNodeIndex(nodes, targetNodeId)
  return nodes.map((n, i) => {
    if (i < targetIndex) return n
    if (n.status === "error" || i === targetIndex) {
      return { ...n, status: "pending" as const, error: undefined }
    }
    return n
  })
}

export function assembleFinalFromResults(
  results: SubtaskResult[],
  citationsMarkdown: string
): string {
  const lastOutput = results
    .map((r) => r.output)
    .reverse()
    .find((o) => {
      const rec = asRecord(o)
      return typeof rec["text"] === "string" || typeof rec["finalResponse"] === "string"
    })

  const rec = asRecord(lastOutput)
  const text =
    typeof rec["finalResponse"] === "string"
      ? String(rec["finalResponse"])
      : typeof rec["text"] === "string"
        ? String(rec["text"])
        : null

  if (text) {
    return [text, citationsMarkdown ? `\n\n${citationsMarkdown}` : ""].filter(Boolean).join("")
  }

  return [
    "我已执行完工作流，但未生成最终回答文本。",
    "",
    "子任务摘要：",
    ...results.map((r) => `- ${r.id}: ${r.ok ? "OK" : "ERR"} · ${r.summary}`),
  ].join("\n")
}
