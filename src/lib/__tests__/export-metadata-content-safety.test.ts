import { describe, expect, it } from "vitest"

import {
  buildExportMetadataMarkdown,
  prependExportMetadata,
  stripStaleExportMetadata,
} from "../export-metadata"

/**
 * 导出前会先剥掉「上一次导出留下的元数据行」，再插入新表头。
 * 但剥离用的是纯行首匹配：`^\s*(?:>\s*)?(?:\*\*)?(?:Model|模型|…)\s*[:：]`
 * —— 引用块的 `>` 是可选的，于是**正文里任何以 `Model:` 开头的行都会被删掉**。
 * 对一篇讲模型结构的论文/画布来说，「Model: ResNet-50 作为骨干网络」是正文，
 * 导出即丢失。
 */
describe("导出元数据剥离不误伤正文", () => {
  it("正文里以 Model: 开头的普通行保留", () => {
    const out = stripStaleExportMetadata("Model: ResNet-50 作为骨干网络\n\n其余正文")
    expect(out).toContain("Model: ResNet-50")
  })

  it("正文里以 模型： 开头的普通行保留", () => {
    const out = stripStaleExportMetadata("模型：BERT-base，参数量 110M")
    expect(out).toContain("模型：BERT-base")
  })

  it("真正的旧表头（引用块形式）仍然被删除", () => {
    const out = stripStaleExportMetadata("> 模型：gpt-4o\n> 检索日期：2026-01-01\n\n正文")
    expect(out).not.toContain("gpt-4o")
    expect(out).toContain("正文")
  })

  it("连续两次 prepend 不会累积表头", () => {
    const meta = { model: "deepseek-chat", retrievalDate: "2026-01-01 00:00:00", exportedAt: "2026-01-02 00:00:00" }
    const once = prependExportMetadata("正文", meta, "zh")
    const twice = prependExportMetadata(once, meta, "zh")
    expect(twice.match(/^> 模型：/gm)).toHaveLength(1)
  })
})

describe("模型名里的控制字符", () => {
  it("换行不会把表头撑成多行或注入标题", () => {
    const md = buildExportMetadataMarkdown(
      { model: "gpt-4o\n\n# 注入标题", retrievalDate: "r", exportedAt: "e" },
      "zh"
    )
    expect(md.split("\n").filter((l) => l.startsWith(">"))).toHaveLength(3)
    expect(md.split("\n").some((l) => l.startsWith("#"))).toBe(false)
  })

  it("英文模板同样处理", () => {
    const md = buildExportMetadataMarkdown(
      { model: "gpt-4o\r\n> 伪造引用行", retrievalDate: "r", exportedAt: "e" },
      "en"
    )
    expect(md.split("\n").filter((l) => l.startsWith(">"))).toHaveLength(3)
  })
})
