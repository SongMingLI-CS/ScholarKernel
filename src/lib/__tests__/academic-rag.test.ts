import { describe, expect, it } from "vitest"

import { clampReasoningPrompt } from "@/lib/tools/academic-search-strategy"
import {
  AcademicChunkArraySchema,
  detectSectionTitle,
  formatAcademicChunksForContext,
  semanticChunkAcademicText,
} from "@/lib/document/academic-semantic-chunker"
import { applyColumnReorder, resolvePageMidline, type LayoutTextBlock } from "@/lib/document/column-reorder"
import { normalizeAcademicFormulas } from "@/lib/document/formula-normalizer"
import { parseLayoutAwareDocument } from "@/lib/document/layout-aware-parser"
import { enrichPeerReviewSubject } from "@/lib/agent/peer-review-runner"

const DIRTY_DOUBLE_COLUMN = [
  "L1 intro left column opening sentence about transformers.",
  "R1 right column should not precede left body completion.",
  "L2 we propose a novel attention mechanism with sparse routing.",
  "R2 prior work on mixture-of-experts lacks theoretical guarantees.",
  "L3 our method reduces FLOPs while preserving accuracy.",
  "R3 experiments on ImageNet and CIFAR validate the approach.",
  "L4 ablation studies confirm each component contributes.",
  "R4 code and checkpoints will be released upon acceptance.",
].join("\n")

const NESTED_MATRIX_RAW = [
  "3. Methodology",
  "We optimize the objective with nested structure:",
  "\\begin{pmatrix}",
  "a & b \\\\",
  "c & d",
  "\\end{pmatrix}",
  "x = \\sum_{i=1}^{n} \\alpha_i \\int_0^1 f_i(t) \\, dt",
  "where W_{i,j}^{(l)} denotes layer weights.",
].join("\n")

const LONG_REFERENCES = [
  "References",
  ...Array.from({ length: 40 }, (_, i) =>
    `[${i + 1}] Author${i}, B. et al. (${2010 + (i % 10)}). Paper title number ${i + 1} about deep learning systems.`
  ),
].join("\n")

const FULL_DIRTY_PAPER = [
  DIRTY_DOUBLE_COLUMN,
  "",
  NESTED_MATRIX_RAW,
  "",
  "4. Experiments",
  "We compare against ResNet-50 and ViT-B/16 on standard benchmarks.",
  "",
  LONG_REFERENCES,
].join("\n")

describe("academic-rag pipeline", () => {
  it("preserves the reading order when plain text has no column coordinates", () => {
    const out = applyColumnReorder(DIRTY_DOUBLE_COLUMN)
    expect(out.layout).toBe("unknown")
    expect(out.text).toBe(DIRTY_DOUBLE_COLUMN)
  })

  it("uses page midline from MediaBox width for coordinate blocks", () => {
    const blocks: LayoutTextBlock[] = [
      { text: "Left block A", x: 50, y: 700, page: 1 },
      { text: "Right block A", x: 350, y: 700, page: 1 },
      { text: "Left block B", x: 55, y: 680, page: 1 },
      { text: "Right block B", x: 355, y: 680, page: 1 },
    ]
    const midline = resolvePageMidline(blocks, { page: 1, width: 612 })
    expect(midline).toBe(306)
    const out = applyColumnReorder("", blocks, [{ page: 1, width: 612 }])
    expect(out.layout).toBe("double")
    expect(out.text.indexOf("Left block A")).toBeLessThan(out.text.indexOf("Right block A"))
  })

  it("normalizes nested matrix and sum/int LaTeX delimiters", () => {
    const out = normalizeAcademicFormulas(NESTED_MATRIX_RAW)
    expect(out).toContain("$$")
    expect(out).toContain("\\sum")
    expect(out).toContain("\\int")
    expect(out).toContain("\\alpha")
    expect(out).toMatch(/\$W_\{i,j\}\^\{\(l\)\}\$|W_\{i,j\}/)
  })

  it("semantic-chunks by section boundaries with Zod-valid metadata", () => {
    const normalized = normalizeAcademicFormulas(
      applyColumnReorder(FULL_DIRTY_PAPER).text
    )
    const chunks = semanticChunkAcademicText({ text: normalized })
    const validated = AcademicChunkArraySchema.parse(chunks)

    expect(validated.length).toBeGreaterThanOrEqual(3)

    const sections = validated.map((c) => c.metadata.section)
    expect(sections.some((s) => /methodology/i.test(s))).toBe(true)
    expect(sections.some((s) => /experiments/i.test(s))).toBe(true)
    expect(sections.some((s) => /references/i.test(s))).toBe(true)

    const refChunk = validated.find((c) => /references/i.test(c.metadata.section))
    expect(refChunk?.text.split("\n").length).toBeGreaterThan(10)

    for (const chunk of validated) {
      expect(chunk.metadata.index).toBeGreaterThanOrEqual(0)
      expect(chunk.text.trim().length).toBeGreaterThan(0)
    }
  })

  it("detectSectionTitle recognizes numbered academic headings", () => {
    expect(detectSectionTitle("1. Introduction")).toBe("Introduction")
    expect(detectSectionTitle("2. Related Work")).toBe("Related Work")
    expect(detectSectionTitle("## 3. Methodology")).toBe("Methodology")
    expect(detectSectionTitle("References")).toBe("References")
    expect(detectSectionTitle("2 方法")).toBe("Methodology")
    expect(detectSectionTitle("参考文献")).toBe("References")
    expect(detectSectionTitle("Introduction This paper studies attention")).toBeNull()
  })

  it("keeps absent page mappings unknown and only records observed page values", () => {
    const text = "2 方法\n\n具体实现说明"
    const unknown = semanticChunkAcademicText({
      text,
      pageGeometries: [{ page: 1, width: 612 }, { page: 2, width: 612 }],
    })
    expect(unknown[0]?.metadata.page).toBeUndefined()

    const observed = semanticChunkAcademicText({
      text,
      blocks: [{ text: "具体实现说明", x: 40, y: 700, page: 7 }],
    })
    expect(observed[0]?.metadata.page).toBe(7)
  })

  it("splits long sections into bounded chunks without inventing page metadata", () => {
    const paragraphs = Array.from({ length: 8 }, (_, index) => `段落${index + 1} ${"研究方法与实验结果。".repeat(40)}`)
    const chunks = semanticChunkAcademicText({ text: `1. Methodology\n${paragraphs.join("\n")}` })

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.text.length <= 2400)).toBe(true)
    expect(chunks.every((chunk) => chunk.metadata.page === undefined)).toBe(true)
    expect(chunks.every((chunk) => chunk.metadata.section === "Methodology")).toBe(true)
  })

  it("formatAcademicChunksForContext emits section-tagged RAG blocks", () => {
    const chunks = semanticChunkAcademicText({
      text: "1. Introduction\n\nWe study RAG.\n\n2. Methodology\n\nOur parser uses layout cues.",
    })
    const ctx = formatAcademicChunksForContext(chunks)
    expect(ctx).toContain("[学术语义切片")
    expect(ctx).toContain("[Introduction")
    expect(ctx).toContain("[Methodology")
  })

  it("bounds reasoning prompts and preserves references and final tool guidance when possible", () => {
    const prompt = [
      "用户需求：比较研究",
      "完整参考文献：[1] Paper A https://example.org/paper-a",
      "已完成子任务结果（JSON）：",
      "{" + '"result":"' + "x".repeat(500) + '"}',
      "",
      "你可以：调用工具",
    ].join("\n")

    const clamped = clampReasoningPrompt(prompt, 300)

    expect(clamped.length).toBeLessThanOrEqual(300)
    expect(clamped).toContain("Paper A https://example.org/paper-a")
    expect(clamped).toContain("[...subtask results truncated by contextLimit...]")
    expect(clamped.endsWith("你可以：调用工具")).toBe(true)
    expect(clampReasoningPrompt("x".repeat(50), 12)).toBe("x".repeat(12))
  })

  it("enrichPeerReviewSubject replaces duplicate full text with semantic RAG chunks", () => {
    const longSubject = FULL_DIRTY_PAPER.repeat(3)
    const enriched = enrichPeerReviewSubject(longSubject)
    expect(enriched).not.toContain(longSubject)
    expect(enriched.startsWith("[学术语义切片")).toBe(true)
    expect(enriched).toContain("[学术语义切片")
  })

  it("parseLayoutAwareDocument returns chunks for plain-text uploads", async () => {
    const parsed = await parseLayoutAwareDocument({
      buffer: Buffer.from(FULL_DIRTY_PAPER, "utf8"),
      filename: "sample.txt",
    })
    expect(parsed.chunks.length).toBeGreaterThan(0)
    expect(AcademicChunkArraySchema.safeParse(parsed.chunks).success).toBe(true)
    expect(parsed.ragContext).toContain("学术语义切片")
  })
})
