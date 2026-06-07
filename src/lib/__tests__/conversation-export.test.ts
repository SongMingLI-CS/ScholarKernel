import { describe, expect, it } from "vitest"

import {
  buildConversationPrintHtml,
  exportConversationAsDocx,
  filterExportableMessages,
  isInternalExportNoise,
} from "@/lib/export-utils"
import { buildExportMetadata } from "@/lib/export-metadata"
import type { ChatMessage } from "@/store/useAgentStore"

const planJson = JSON.stringify({
  tasks: [{ id: "1", type: "research", provider: "cloud", status: "pending", title: "检索" }],
})

describe("conversation export", () => {
  it("filters internal workflow plan JSON from export", () => {
    expect(isInternalExportNoise(planJson)).toBe(true)
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "帮我调研" },
      { id: "a1", role: "assistant", content: planJson },
      { id: "a2", role: "assistant", content: "这是正式回复。" },
    ]
    const filtered = filterExportableMessages(messages)
    expect(filtered).toHaveLength(2)
    expect(filtered.map((m) => m.id)).toEqual(["u1", "a2"])
  })

  it("builds print html with user and assistant sections", () => {
    const meta = buildExportMetadata({
      lang: "zh",
      activeProvider: { providerId: "deepseek_openai_compat", model: "deepseek-reasoner" },
      retrievalAt: "2026-06-07T08:00:00.000Z",
      exportedAt: "2026-06-07T09:00:00.000Z",
    })
    const html = buildConversationPrintHtml(
      "测试对话",
      [
        { id: "u1", role: "user", content: "你好" },
        { id: "a1", role: "assistant", content: "**加粗**回复" },
      ],
      meta,
      "zh"
    )
    expect(html).toContain("测试对话")
    expect(html).toContain("msg-user")
    expect(html).toContain("msg-assistant")
    expect(html).toContain("<strong>加粗</strong>")
    expect(html).toContain("deepseek-reasoner")
    expect(html).toContain("检索日期")
  })

  it("exports conversation as docx blob", async () => {
    const blob = await exportConversationAsDocx("Demo", [
      { id: "u1", role: "user", content: "# 问题\n\n内容" },
      { id: "a1", role: "assistant", content: "## 回答\n\n**结论**" },
    ])
    expect(blob.size).toBeGreaterThan(800)
    expect(blob.type).toContain("wordprocessingml")
  })
})
