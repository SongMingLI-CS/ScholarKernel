"use client"

import React, { Component, type ErrorInfo, type ReactNode, memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
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
        "relative w-[200px] rounded-sm border px-3 py-2 text-sm font-semibold tracking-wide transition-shadow duration-300",
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
        <div className="mt-1 leading-snug">{data.label}</div>
      </div>

      {isWorkflow ? (
        <div className="mt-2 max-h-[120px] overflow-auto rounded-sm border border-border/50 bg-background/40 p-2 font-mono text-[10px] leading-snug text-muted-foreground">
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

class TopologyFlowErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e : new Error(String(e)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[TopologyView] render failed", error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full min-h-[500px] w-full flex-col items-center justify-center gap-2 rounded-sm border border-rose-500/30 bg-rose-500/10 px-4 text-center font-mono text-[12px] text-rose-100/95">
          <div>拓扑图渲染失败</div>
          <div className="max-w-md text-[11px] text-rose-100/80">{this.state.error.message}</div>
          <button
            type="button"
            className="mt-2 rounded-sm border border-border/60 bg-background/60 px-3 py-1.5 text-[11px] text-foreground hover:bg-background"
            onClick={() => this.setState({ error: null })}
          >
            重试
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function workflowToFlow(nodes: WorkflowNode[], activeNodeId: string | null): { nodes: Node[]; edges: Edge[] } {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { nodes: [], edges: [] }
  }
  const gapX = 240
  const startX = 40
  const yMain = 140
  const yBranch = 40

  const flowNodes: Node[] = nodes.map((n, idx) => ({
    id: n.id,
    position: { x: startX + idx * gapX, y: n.type === "research" ? yBranch : yMain },
    data: {
      label: n.type === "research" ? "全球检索 (Global Search)" : (n.title ?? n.id),
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
    style: { width: 220 },
  }))

  const flowEdges: Edge[] = []
  for (let i = 1; i < nodes.length; i++) {
    const prev = nodes[i - 1]!
    const cur = nodes[i]!
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

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === "undefined") {
      setMeasured(true)
      return
    }

    const update = () => {
      const { width, height } = el.getBoundingClientRect()
      setMeasured(width > 0 && height > 0)
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const statusSignature = useMemo(
    () => flowNodes.map((n) => `${n.id}:${(n.data as WorkflowNodeData).status ?? "pending"}`).join("|"),
    [flowNodes]
  )

  useEffect(() => {
    if (!measured || flowNodes.length === 0) return
    const timer = window.setTimeout(() => {
      fitView({ padding: 0.2, duration: 800 })
    }, 64)
    return () => window.clearTimeout(timer)
  }, [fitView, flowNodes.length, layoutKey, measured, statusSignature])

  return (
    <div ref={containerRef} className="absolute inset-0 h-full w-full min-h-[500px]">
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
        <div className="flex h-full min-h-[500px] w-full items-center justify-center font-mono text-[11px] text-muted-foreground">
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
      style: { width: 200 },
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
    <div
      className={cn(
        "h-full min-h-[500px] w-full overflow-hidden rounded-sm border border-border/60 bg-card/20",
        anyRunning && "sk-topology-live"
      )}
    >
      <TopologyFlowErrorBoundary>
        <div className="relative h-full w-full min-h-[500px] overflow-hidden">
          <ReactFlowProvider>
            <TopologyFlowCanvas
              flowNodes={flowNodes}
              flowEdges={flowEdges}
              onNodeClick={onNodeClick}
              layoutKey={layoutKey}
            />
          </ReactFlowProvider>
        </div>
      </TopologyFlowErrorBoundary>
    </div>
  )
})
