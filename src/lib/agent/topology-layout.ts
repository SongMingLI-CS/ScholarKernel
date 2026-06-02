import type { WorkflowNode } from "@/lib/agent/planner"

export type FlowLayoutOpts = {
  gapX: number
  startX: number
  yMain: number
  yBranch: number
}

export type PeerReviewFlowLayout = {
  positions: Record<string, { x: number; y: number }>
  edges: Array<{ id: string; source: string; target: string; dashed?: boolean }>
}

/** 为 peer_review 三连节点（R1∥R2 → R3）计算 React Flow 分叉/汇聚布局。 */
export function peerReviewGroupToFlowLayout(
  groupNodes: WorkflowNode[],
  groupStartIndex: number,
  opts: FlowLayoutOpts
): PeerReviewFlowLayout {
  const { gapX, startX, yMain, yBranch } = opts
  const baseX = startX + groupStartIndex * gapX
  const reviewerX = baseX + gapX
  const chairX = baseX + gapX * 2

  const r1 = groupNodes[0]
  const r2 = groupNodes[1]
  const r3 = groupNodes[2]

  const positions: Record<string, { x: number; y: number }> = {}
  const edges: PeerReviewFlowLayout["edges"] = []

  if (r1) positions[r1.id] = { x: reviewerX, y: yBranch }
  if (r2) positions[r2.id] = { x: reviewerX, y: yMain + 80 }
  if (r3) positions[r3.id] = { x: chairX, y: yMain }

  if (r1 && r3) {
    edges.push({ id: `peer-e-${r1.id}-${r3.id}`, source: r1.id, target: r3.id })
  }
  if (r2 && r3) {
    edges.push({ id: `peer-e-${r2.id}-${r3.id}`, source: r2.id, target: r3.id })
  }

  if (groupStartIndex > 0 && r1) {
    const prevId = `__prev-${groupStartIndex}`
    edges.push({ id: `peer-in-${groupStartIndex}`, source: prevId, target: r1.id, dashed: true })
    edges.push({ id: `peer-in2-${groupStartIndex}`, source: prevId, target: r2?.id ?? r1.id, dashed: true })
  }

  return { positions, edges }
}

export function findPeerReviewGroups(nodes: WorkflowNode[]): Array<{ start: number; end: number; nodes: WorkflowNode[] }> {
  const groups: Array<{ start: number; end: number; nodes: WorkflowNode[] }> = []
  let i = 0
  while (i < nodes.length) {
    if (nodes[i]?.type === "peer_review") {
      const start = i
      const chunk: WorkflowNode[] = []
      while (i < nodes.length && nodes[i]?.type === "peer_review") {
        chunk.push(nodes[i]!)
        i++
      }
      groups.push({ start, end: i - 1, nodes: chunk })
    } else {
      i++
    }
  }
  return groups
}
