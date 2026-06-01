import { describe, expect, it } from "vitest"

import {
  deriveConversationTitle,
  filterConversationsByQuery,
  findLastRegenerablePair,
  formatConversationAsMarkdown,
  isDefaultConversationTitle,
  sanitizeExportFilename,
} from "@/lib/conversation-utils"
import type { ConversationSummary } from "@/lib/db-types"

const sampleConversations: ConversationSummary[] = [
  {
    id: "1",
    title: "量子计算综述",
    isPinned: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
  {
    id: "2",
    title: "Transformer 架构分析",
    isPinned: false,
    createdAt: "2026-01-03T00:00:00.000Z",
    updatedAt: "2026-01-04T00:00:00.000Z",
  },
  {
    id: "3",
    title: "Daily notes",
    isPinned: false,
    createdAt: "2026-01-05T00:00:00.000Z",
    updatedAt: "2026-01-06T00:00:00.000Z",
  },
]

describe("formatConversationAsMarkdown", () => {
  it("formats user and assistant messages with role headings", () => {
    const md = formatConversationAsMarkdown("测试对话", [
      { id: "u1", role: "user", content: "你好" },
      { id: "a1", role: "assistant", content: "你好，有什么可以帮你？" },
    ])
    expect(md).toContain("# 测试对话")
    expect(md).toContain("## 用户")
    expect(md).toContain("你好")
    expect(md).toContain("## 助手")
    expect(md).toContain("有什么可以帮你")
  })

  it("skips empty system messages", () => {
    const md = formatConversationAsMarkdown("Boot", [
      { id: "s1", role: "system", content: "" },
      { id: "u1", role: "user", content: "Hi" },
    ])
    expect(md).not.toContain("## 系统")
    expect(md).toContain("## 用户")
  })

  it("appends sources section when present", () => {
    const md = formatConversationAsMarkdown("Research", [
      {
        id: "a1",
        role: "assistant",
        content: "结论如下",
        sources: [{ title: "Paper A", url: "https://example.com/a" }],
      },
    ])
    expect(md).toContain("### 引用来源")
    expect(md).toContain("[Paper A](https://example.com/a)")
  })
})

describe("filterConversationsByQuery", () => {
  it("returns all when query is empty", () => {
    expect(filterConversationsByQuery(sampleConversations, "")).toHaveLength(3)
    expect(filterConversationsByQuery(sampleConversations, "   ")).toHaveLength(3)
  })

  it("filters by title case-insensitively", () => {
    const result = filterConversationsByQuery(sampleConversations, "transformer")
    expect(result).toHaveLength(1)
    expect(result[0]?.title).toBe("Transformer 架构分析")
  })

  it("supports partial Chinese match", () => {
    const result = filterConversationsByQuery(sampleConversations, "量子")
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe("1")
  })
})

describe("sanitizeExportFilename", () => {
  it("replaces unsafe characters and adds extension", () => {
    expect(sanitizeExportFilename("Hello/World?")).toBe("Hello-World-.md")
  })

  it("falls back to default when title is blank", () => {
    expect(sanitizeExportFilename("   ")).toBe("scholarkernel-conversation.md")
  })
})

describe("deriveConversationTitle", () => {
  it("uses first line trimmed", () => {
    expect(deriveConversationTitle("  量子计算综述  ")).toBe("量子计算综述")
  })

  it("truncates long titles with ellipsis", () => {
    const long = "这是一段非常非常非常非常非常非常非常非常长的用户输入标题"
    const title = deriveConversationTitle(long, 12)
    expect(title.endsWith("…")).toBe(true)
    expect(title.length).toBeLessThanOrEqual(12)
  })

  it("falls back for blank input", () => {
    expect(deriveConversationTitle("   ")).toBe("新对话")
  })
})

describe("isDefaultConversationTitle", () => {
  it("detects default zh/en titles", () => {
    expect(isDefaultConversationTitle("新对话")).toBe(true)
    expect(isDefaultConversationTitle("New Chat")).toBe(true)
    expect(isDefaultConversationTitle("量子计算")).toBe(false)
  })
})

describe("findLastRegenerablePair", () => {
  it("returns last user-assistant pair", () => {
    const pair = findLastRegenerablePair([
      { id: "u1", role: "user", content: "A" },
      { id: "a1", role: "assistant", content: "B" },
      { id: "u2", role: "user", content: "C" },
      { id: "a2", role: "assistant", content: "D" },
    ])
    expect(pair).toEqual({ userText: "C", assistantId: "a2", trimBeforeIndex: 3 })
  })

  it("returns null when no assistant", () => {
    expect(findLastRegenerablePair([{ id: "u1", role: "user", content: "A" }])).toBeNull()
  })
})
