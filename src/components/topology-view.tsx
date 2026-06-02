"use client"

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactFlow, {
  Background,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlowProvider,
  useReactFlow,
} from "reactflow"
import "reactflow/dist/style.css"

import { ComponentSandbox } from "@/components/component-sandbox"
import { WelcomeEmptyState } from "@/components/welcome-empty-state"
import { t as tGlobal } from "@/lib/locales"
import { findPeerReviewGroups, peerReviewGroupToFlowLayout } from "@/lib/agent/topology-layout"
import { cn } from "@/lib/utils"
import { useAgentStore, type TopologyState, type WorkflowNode, type WorkflowNodeStatus } from "@/store/useAgentStore"

type FlowStatus = TopologyState["nodes"][number]["status"] | WorkflowNodeStatus

function statusClass(status: FlowStatus) {
  switch (status) {
    case "running":
      return cn(
        "border-sky-400/60 bg-gradient-to-br from-sky-500/18 to-blue-600/10 text-foreground",
        "shadow-[0_0_0_1px_oklch(0.62_0.19_230/0.4),0_0_24px_oklch(0.55_0.2_250/0.35)]",
        "sk-node-running"
      )
    case "done":
      return cn(
        "border-emerald-500/55 bg-gradient-to-br from-emerald-500/16 to-emerald-600/8 text-emerald-50",
        "shadow-[0_0_0_1px_oklch(0.65_0.17_145/0.4),0_0_20px_oklch(0.62_0.17_145/0.28)]",
        "sk-node-done"
      )
    case "error":
      return cn(
        "border-rose-500/55 bg-gradient-to-br from-rose-500/16 to-rose-600/8 text-rose-50",
        "shadow-[0_0_0_1px_oklch(0.58_0.22_25/0.45),0_0_22px_oklch(0.55_0.2_25/0.32)]",
        "sk-node-error"
      )
    case "pending":
      return cn(
        "border-zinc-500/40 bg-zinc-500/8 text-zinc-300/85",
        "shadow-[inset_0_0_0_1px_oklch(1_0_0/0.05),0_0_8px_oklch(0.5_0_0/0.08)]"
      )
    default:
      return "border-zinc-500/35 bg-background/35 text-muted-foreground shadow-[inset_0_0_0_1px_oklch(1_0_0/0.04)]"
  }
}

type ProviderNodeData = { label: string; status: TopologyState["nodes"][number]["status"] }
type WorkflowNodeData = {
  label: string
  status: WorkflowNode["status"]
  provider: WorkflowNode["provider"]
  type: WorkflowNode["type"]
  logs: string[]
  active?: boolean
  error?: string
  metadata?: WorkflowNode["metadata"]
}

function extractProgress(meta: WorkflowNode["metadata"] | undefined): { ratio: number; label?: string } | null {
  if (!meta) return null
  const raw =
    (meta["progress"] ?? meta["progressRatio"] ?? meta["progress_ratio"] ?? meta["progressPct"] ?? meta["progress_pct"]) as unknown
  const label = typeof meta["progressLabel"] === "string" ? String(meta["progressLabel"]) : undefined

  if (typeof raw === "number" && Number.isFinite(raw)) {
    const v = raw > 1 ? raw / 100 : raw
    const ratio = Math.max(0, Math.min(1, v))
    return { ratio, label }
  }

  const cur = meta["current"] ?? meta["done"] ?? meta["completed"]
  const total = meta["total"] ?? meta["count"] ?? meta["max"]
  if (typeof cur === "number" && typeof total === "number" && Number.isFinite(cur) && Number.isFinite(total) && total > 0) {
    const ratio = Math.max(0, Math.min(1, cur / total))
    return { ratio, label: label ?? `${Math.round(cur)}/${Math.round(total)}` }
  }

  return null
}

function IndustrialNode({ data }: NodeProps<ProviderNodeData | WorkflowNodeData>) {
  const streaming = useAgentStore((s) => s.inference.streaming?.active)
  const isWorkflow = "provider" in data
  const energize = Boolean((isWorkflow ? Boolean((data as WorkflowNodeData).active) : streaming) && data.status === "running")
  const wf = isWorkflow ? (data as WorkflowNodeData) : null
  const fallbackReason =
    wf?.metadata && (wf.metadata["fallbackReason"] || wf.metadata["fallback_reason"] || wf.metadata["fallback"])
      ? String(wf.metadata["fallbackReason"] ?? wf.metadata["fallback_reason"] ?? "fallback")
      : ""
  const isFallback = Boolean(fallbackReason)
  const isWarn =
    isFallback || (isWorkflow && (data as WorkflowNodeData).status === "error") || Boolean((data as WorkflowNodeData).error)
  const progress = isWorkflow ? extractProgress((data as WorkflowNodeData).metadata) : null
  const nodeStatus = (data.status === "idle" ? "pending" : data.status) as FlowStatus

  return (
    <div
      className={cn(
        "relative w-full min-w-0 max-w-[220px] rounded-sm border px-3 py-2 text-sm font-semibold tracking-wide transition-shadow duration-300",
        statusClass(nodeStatus),
        isWarn && "border-amber-500/55 bg-amber-500/10 text-amber-100",
        energize && "sk-node-energy"
      )}
    >
      <Handle type="target" position={Position.Left} className="!opacity-0 !border-0 !bg-transparent" />
      <Handle type="source" position={Position.Right} className="!opacity-0 !border-0 !bg-transparent" />

      <div>
        <div className="flex items-center justify-between gap-2 font-mono text-[10px] font-semibold tracking-wider text-muted-foreground">
          <span>{data.status}</span>
          {isWorkflow ? (
            <span className="rounded-sm border border-border/60 bg-muted/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider">
              {(data as WorkflowNodeData).provider}/{(data as WorkflowNodeData).type}
            </span>
          ) : null}
        </div>
        <div className="mt-1 break-words leading-snug [overflow-wrap:anywhere]">{data.label}</div>
      </div>

      {isWorkflow ? (
        <div className="mt-2 max-h-[120px] overflow-auto sk-scrollbar rounded-sm border border-border/50 bg-background/40 p-2 font-mono text-[10px] leading-snug text-muted-foreground">
          {isFallback ? (
            <div className="mb-2 whitespace-pre-wrap rounded-sm border border-amber-500/30 bg-amber-500/10 p-2 text-amber-100/90">
              Fallback：{fallbackReason}
            </div>
          ) : null}
          {(data as WorkflowNodeData).status === "error" && (data as WorkflowNodeData).error ? (
            <div className="mb-2 whitespace-pre-wrap rounded-sm border border-rose-500/25 bg-rose-500/10 p-2 text-rose-100/90">
              {(data as WorkflowNodeData).error}
            </div>
          ) : null}
          {(data as WorkflowNodeData).logs.length === 0 ? (
            <div className="opacity-70">（暂无日志）</div>
          ) : (
            (data as WorkflowNodeData).logs.slice(-12).map((l, i) => (
              <div key={i} className="whitespace-pre-wrap">
                {l}
              </div>
            ))
          )}
        </div>
      ) : null}

      {isWorkflow && progress ? (
        <div className="mt-2">
          <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
            <span>progress</span>
            <span>{progress.label ?? `${Math.round(progress.ratio * 100)}%`}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/40">
            <div className="h-full bg-emerald-400/70" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

const nodeTypes = { industrial: IndustrialNode }

function workflowNodeLabel(n: WorkflowNode): string {
  if (n.type === "research") return "全球检索 (Global Search)"
  if (n.type === "peer_review") return n.title ?? "Peer Review"
  return n.title ?? n.id
}

function workflowToFlow(nodes: WorkflowNode[], activeNodeId: string | null): { nodes: Node[]; edges: Edge[] } {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { nodes: [], edges: [] }
  }
  const gapX = 240
  const startX = 40
  const yMain = 140
  const yBranch = 40

  const peerGroups = findPeerReviewGroups(nodes)
  const peerGroupByStart = new Map(peerGroups.map((g) => [g.start, g]))
  const peerNodeIds = new Set(peerGroups.flatMap((g) => g.nodes.map((n) => n.id)))
  const peerLayouts = new Map<number, ReturnType<typeof peerReviewGroupToFlowLayout>>()
  for (const g of peerGroups) {
    peerLayouts.set(g.start, peerReviewGroupToFlowLayout(g.nodes, g.start, { gapX, startX, yMain, yBranch }))
  }

  const flowNodes: Node[] = nodes.map((n, idx) => {
    const peerGroup = peerGroupByStart.get(idx)
    const inPeerGroup = peerNodeIds.has(n.id)
    let position = { x: startX + idx * gapX, y: n.type === "research" ? yBranch : yMain }

    if (peerGroup) {
      const layout = peerLayouts.get(peerGroup.start)
      position = layout?.positions[n.id] ?? position
    } else if (inPeerGroup) {
      for (const g of peerGroups) {
        if (g.nodes.some((pn) => pn.id === n.id)) {
          const layout = peerLayouts.get(g.start)
          position = layout?.positions[n.id] ?? position
          break
        }
      }
    }

    return {
      id: n.id,
      position,
      data: {
        label: workflowNodeLabel(n),
        status: n.status,
        provider: n.provider,
        type: n.type,
        logs: n.logs ?? [],
        active: n.id === activeNodeId,
        error: typeof n.error === "string" ? n.error : undefined,
        metadata: n.metadata,
      } satisfies WorkflowNodeData,
      type: "industrial",
      draggable: false,
      selectable: true,
      style: { width: 220, minWidth: 0, maxWidth: "100%" },
    }
  })

  const flowEdges: Edge[] = []
  const peerEdgeKeys = new Set<string>()

  for (const g of peerGroups) {
    const layout = peerLayouts.get(g.start)
    if (!layout) continue
    for (const e of layout.edges) {
      if (e.source.startsWith("__prev")) continue
      peerEdgeKeys.add(`${e.source}->${e.target}`)
      flowEdges.push({
        id: e.id,
        source: e.source,
        target: e.target,
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
        style: {
          stroke: "oklch(0.556 0 0 / 0.55)",
          strokeWidth: 1.25,
          ...(e.dashed ? { strokeDasharray: "4 4" } : {}),
        },
      })
    }
    if (g.start > 0) {
      const prev = nodes[g.start - 1]!
      const r1 = g.nodes[0]
      const r2 = g.nodes[1]
      if (r1) {
        flowEdges.push({
          id: `wf-peer-in-${g.start}-r1`,
          source: prev.id,
          target: r1.id,
          markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
          style: { stroke: "oklch(0.556 0 0 / 0.55)", strokeWidth: 1.25 },
        })
      }
      if (r2) {
        flowEdges.push({
          id: `wf-peer-in-${g.start}-r2`,
          source: prev.id,
          target: r2.id,
          markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
          style: { stroke: "oklch(0.556 0 0 / 0.35)", strokeWidth: 1.1, strokeDasharray: "4 4" },
        })
      }
    }
    const afterIdx = g.end + 1
    if (afterIdx < nodes.length) {
      const r3 = g.nodes[g.nodes.length - 1]
      const next = nodes[afterIdx]!
      if (r3) {
        flowEdges.push({
          id: `wf-peer-out-${g.end}`,
          source: r3.id,
          target: next.id,
          markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
          style: { stroke: "oklch(0.556 0 0 / 0.55)", strokeWidth: 1.25 },
        })
      }
    }
  }

  for (let i = 1; i < nodes.length; i++) {
    const prev = nodes[i - 1]!
    const cur = nodes[i]!
    const edgeKey = `${prev.id}->${cur.id}`
    if (peerEdgeKeys.has(edgeKey)) continue
    if (peerNodeIds.has(prev.id) && peerNodeIds.has(cur.id)) continue
    if (peerNodeIds.has(cur.id) && peerGroupByStart.has(i)) continue

    flowEdges.push({
      id: `wf-e-${i - 1}`,
      source: prev.id,
      target: cur.id,
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      style: { stroke: "oklch(0.556 0 0 / 0.55)", strokeWidth: 1.25 },
    })

    if (cur.type === "research" && i + 1 < nodes.length) {
      const next = nodes[i + 1]!
      flowEdges.push({
        id: `wf-fork-${i}`,
        source: prev.id,
        target: next.id,
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
        style: { stroke: "oklch(0.556 0 0 / 0.35)", strokeWidth: 1.1, strokeDasharray: "4 4" },
      })
    }
  }

  return { nodes: flowNodes, edges: flowEdges }
}

const FIT_VIEW_OPTS = { padding: 0.2, duration: 400 } as const

function TopologyFlowCanvas({
  flowNodes,
  flowEdges,
  onNodeClick,
  layoutKey,
}: {
  flowNodes: Node[]
  flowEdges: Edge[]
  onNodeClick: (_: unknown, node: Node) => void
  layoutKey: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { fitView } = useReactFlow()
  const [measured, setMeasured] = useState(false)
  const sizeRef = useRef({ width: 0, height: 0 })
  const mountedRef = useRef(true)
  const prevNodeCountRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const safeFitView = useCallback(
    (duration: number = FIT_VIEW_OPTS.duration) => {
      if (!mountedRef.current || flowNodes.length === 0) return
      try {
        fitView({ padding: FIT_VIEW_OPTS.padding, duration })
      } catch {
        // React Flow may throw if the pane is tearing down — ignore.
      }
    },
    [fitView, flowNodes.length]
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === "undefined") {
      setMeasured(true)
      return
    }

    let raf = 0
    const update = () => {
      const { width, height } = el.getBoundingClientRect()
      const ok = width > 0 && height > 0
      const changed = width !== sizeRef.current.width || height !== sizeRef.current.height
      sizeRef.current = { width, height }
      setMeasured(ok)
      if (ok && changed && flowNodes.length > 0) {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(() => {
          safeFitView(changed ? FIT_VIEW_OPTS.duration : 0)
        })
      }
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [flowNodes.length, safeFitView])

  useEffect(() => {
    if (flowNodes.length === 0) return
    let raf = 0
    const onWindowResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => safeFitView(FIT_VIEW_OPTS.duration))
    }
    window.addEventListener("resize", onWindowResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", onWindowResize)
    }
  }, [flowNodes.length, safeFitView])

  useEffect(() => {
    if (!measured || flowNodes.length === 0) {
      prevNodeCountRef.current = flowNodes.length
      return
    }
    const grew = flowNodes.length > prevNodeCountRef.current
    prevNodeCountRef.current = flowNodes.length
    if (!grew) return
    let raf = 0
    raf = requestAnimationFrame(() => safeFitView(FIT_VIEW_OPTS.duration))
    return () => cancelAnimationFrame(raf)
  }, [flowNodes.length, measured, safeFitView])

  const statusSignature = useMemo(
    () => flowNodes.map((n) => `${n.id}:${(n.data as WorkflowNodeData).status ?? "pending"}`).join("|"),
    [flowNodes]
  )

  useEffect(() => {
    if (!measured || flowNodes.length === 0) return
    const timer = window.setTimeout(() => safeFitView(FIT_VIEW_OPTS.duration), 48)
    return () => window.clearTimeout(timer)
  }, [flowNodes.length, layoutKey, measured, safeFitView, statusSignature])

  return (
    <div ref={containerRef} className="absolute inset-0 h-full w-full min-h-0">
      {measured ? (
        <ReactFlow
          className="h-full w-full"
          style={{ width: "100%", height: "100%" }}
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          panOnScroll
          zoomOnScroll
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          onNodeClick={onNodeClick}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={18} size={1} color="var(--sk-flow-grid)" />
          <Controls className="!rounded-sm !border-border/60 !bg-background/60 !font-mono !text-xs" />
        </ReactFlow>
      ) : (
        <div className="flex h-full w-full items-center justify-center font-mono text-[11px] text-muted-foreground">
          拓扑画布初始化…
        </div>
      )}
    </div>
  )
}

export const TopologyView = memo(function TopologyView({ topology }: { topology?: TopologyState }) {
  const streaming = useAgentStore((s) => s.inference.streaming?.active)
  const wfNodesRaw = useAgentStore((s) => s.workflow.nodes)
  const wfNodes = useMemo(() => (Array.isArray(wfNodesRaw) ? wfNodesRaw : []), [wfNodesRaw])
  const activeNodeId = useAgentStore((s) => s.workflow.activeNodeId)
  const pushToast = useAgentStore((s) => s.actions.pushToast)

  const shouldShowWorkflow = wfNodes.length > 0
  const workflow = useMemo(() => workflowToFlow(wfNodes, activeNodeId), [activeNodeId, wfNodes])

  const providerNodes: Node[] = useMemo(() => {
    const t = topology
    if (!t) return []
    const gapX = 220
    const startX = 40
    const y = 120
    return t.nodes.map((n, idx) => ({
      id: n.id,
      position: { x: startX + idx * gapX, y },
      data: { label: n.label, status: n.status } satisfies ProviderNodeData,
      type: "industrial",
      draggable: false,
      selectable: true,
      style: { width: 200, minWidth: 0, maxWidth: "100%" },
    }))
  }, [topology])

  const providerEdges: Edge[] = useMemo(() => {
    const t = topology
    if (!t) return []
    return t.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: Boolean(streaming),
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      style: { stroke: "oklch(0.556 0 0 / 0.55)", strokeWidth: 1.25 },
      className: streaming ? "sk-edge-live" : undefined,
    }))
  }, [streaming, topology])

  const anyRunning = shouldShowWorkflow ? wfNodes.some((n) => n.status === "running") : Boolean(streaming)
  const isIdle = !shouldShowWorkflow && !streaming
  const flowNodes = shouldShowWorkflow ? workflow.nodes : providerNodes
  const flowEdges = useMemo(() => {
    const edges = shouldShowWorkflow ? workflow.edges : providerEdges
    if (!Array.isArray(edges)) return []
    return edges.map((e) => ({
      ...e,
      animated: Boolean(anyRunning),
      className: anyRunning ? "sk-edge-live" : undefined,
    }))
  }, [anyRunning, providerEdges, shouldShowWorkflow, workflow.edges])

  const layoutKey = useMemo(() => {
    if (shouldShowWorkflow) {
      return wfNodes.map((n) => `${n.id}:${n.status}`).join("|")
    }
    const t = topology
    if (!t) return "empty"
    return `${t.version}:${t.nodes.map((n) => `${n.id}:${n.status}`).join("|")}`
  }, [shouldShowWorkflow, topology, wfNodes])

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      const data = node.data as Partial<WorkflowNodeData> | undefined
      const isWorkflow = Boolean(data && "provider" in (data as object))
      if (!isWorkflow) return

      const meta = (data as WorkflowNodeData).metadata ?? {}
      const fallbackReason =
        meta && (meta["fallbackReason"] || meta["fallback_reason"] || meta["fallback"])
          ? String(meta["fallbackReason"] ?? meta["fallback_reason"] ?? "fallback")
          : ""
      const err = (data as WorkflowNodeData).error
      const brief = (fallbackReason || err || "").trim().slice(0, 220)
      if (!brief) return
      pushToast({ messageKey: "topology.node.issue", detail: brief, variant: "error", ttlMs: 6200 })
    },
    [pushToast]
  )

  if (!Array.isArray(flowNodes)) {
    return null
  }

  return (
    <ComponentSandbox moduleName={tGlobal("topology.moduleName")} className="h-full min-h-0 w-full">
      <div
        className={cn(
          "h-full min-h-0 w-full overflow-hidden rounded-sm border border-border/60 bg-card/20",
          anyRunning && "sk-topology-live"
        )}
      >
        <div className="relative h-full min-h-0 w-full overflow-hidden">
          <ReactFlowProvider>
            <TopologyFlowCanvas
              flowNodes={flowNodes}
              flowEdges={flowEdges}
              onNodeClick={onNodeClick}
              layoutKey={layoutKey}
            />
          </ReactFlowProvider>
          {isIdle ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/50 p-3 backdrop-blur-[2px]">
              <WelcomeEmptyState variant="topology" className="pointer-events-auto w-full max-w-[18rem]" />
            </div>
          ) : null}
        </div>
      </div>
    </ComponentSandbox>
  )
})
