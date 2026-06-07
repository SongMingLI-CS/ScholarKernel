import { describe, expect, it } from "vitest"

import {
  buildExportMetadata,
  formatExportDateTime,
  gatherExportMetadataFromStore,
  prependExportMetadata,
  resolveExportModel,
  resolveRetrievalTimestamp,
  stripStaleExportMetadata,
} from "@/lib/export-metadata"
import type { WorkflowNode } from "@/store/types"

describe("export-metadata", () => {
  it("formats datetime in Asia/Shanghai timezone", () => {
    const formatted = formatExportDateTime("2026-06-07T04:30:00.000Z", "zh-CN")
    expect(formatted).toMatch(/2026/)
    expect(formatted).toMatch(/12:30:00/)
  })

  it("resolves model from inference then active provider", () => {
    expect(
      resolveExportModel({
        inferenceModel: "deepseek-reasoner",
        activeProvider: { providerId: "deepseek_openai_compat", model: "deepseek-chat" },
      })
    ).toBe("deepseek-reasoner")

    expect(
      resolveExportModel({
        activeProvider: { providerId: "ollama", model: "llama3.1" },
      })
    ).toBe("llama3.1")
  })

  it("resolves retrieval timestamp from search node metadata", () => {
    const nodes: WorkflowNode[] = [
      {
        id: "r1",
        type: "research",
        provider: "cloud",
        status: "done",
        title: "检索",
        logs: [],
        metadata: { kind: "search", searchCompletedAt: "2026-06-07T08:15:00.000Z" },
      },
    ]
    const at = resolveRetrievalTimestamp({ workflowNodes: nodes })
    expect(at?.toISOString()).toBe("2026-06-07T08:15:00.000Z")
  })

  it("strips stale hardcoded metadata lines", () => {
    const raw = [
      "> Model: DeepSeek-V3",
      "> Retrieval Date: 2024-01-01",
      "",
      "## 正文",
      "内容",
    ].join("\n")
    const cleaned = stripStaleExportMetadata(raw)
    expect(cleaned).not.toContain("DeepSeek-V3")
    expect(cleaned).not.toContain("2024-01-01")
    expect(cleaned).toContain("## 正文")
  })

  it("prepends dynamic metadata block", () => {
    const meta = buildExportMetadata({
      lang: "zh",
      activeProvider: { providerId: "deepseek_openai_compat", model: "deepseek-reasoner" },
      retrievalAt: "2026-06-07T08:15:00.000Z",
      exportedAt: "2026-06-07T09:00:00.000Z",
    })
    const out = prependExportMetadata("> Model: GPT-4\n\n正文", meta, "zh")
    expect(out).toContain("> 模型：deepseek-reasoner")
    expect(out).toContain("> 检索日期：")
    expect(out).not.toContain("GPT-4")
    expect(out).toContain("正文")
  })

  it("gathers metadata from workspace snapshot", () => {
    const meta = gatherExportMetadataFromStore({
      providers: { active: { providerId: "ollama", model: "qwen2.5" } },
      inference: {
        streaming: null,
        last: { model: "deepseek-reasoner" },
      },
      workflow: { nodes: [] },
      settings: { lang: "en" },
    })
    expect(meta.model).toBe("deepseek-reasoner")
    expect(meta.retrievalDate).toBeTruthy()
    expect(meta.exportedAt).toBeTruthy()
  })
})
