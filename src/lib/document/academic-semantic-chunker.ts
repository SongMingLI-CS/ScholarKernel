import { z } from "zod"

import type { LayoutTextBlock, PageGeometry } from "@/lib/document/column-reorder"

export const AcademicChunkMetadataSchema = z.object({
  section: z.string().min(1),
  page: z.number().int().positive().optional(),
  index: z.number().int().nonnegative(),
})

export const AcademicChunkSchema = z.object({
  text: z.string().min(1),
  metadata: AcademicChunkMetadataSchema,
})

export const AcademicChunkArraySchema = z.array(AcademicChunkSchema)

export type AcademicChunkMetadata = z.infer<typeof AcademicChunkMetadataSchema>
export type AcademicChunk = z.infer<typeof AcademicChunkSchema>

const SECTION_HEADING_RE =
  /^(?:(?:\d+(?:\.\d+)*\.?\s+)|(?:[IVXLC]+\.\s+))?(Abstract|Introduction|Related\s+Work|Background|Preliminaries|Methodology|Methods|Approach|Model|Architecture|Experiments?|Results?|Discussion|Conclusion|Limitations|Future\s+Work|Acknowledgments?|References?|Bibliography|Appendix(?:\s+[A-Z])?|摘要|引言|绪论|相关工作|研究背景|预备知识|方法|方法论|模型|架构|实验|结果|讨论|结论|局限性|未来工作|致谢|参考文献|附录)\s*[:：]?$/i

const MARKDOWN_HEADING_RE = /^(#{1,3})\s+(.+)$/

const KEYWORD_SECTION_MAP: Array<[RegExp, string]> = [
  [/^(?:abstract|摘要)$/i, "Abstract"],
  [/^(?:introduction|引言|绪论)$/i, "Introduction"],
  [/^(?:related\s+work|相关工作)$/i, "Related Work"],
  [/^(?:background|研究背景)$/i, "Background"],
  [/^(?:preliminaries|预备知识)$/i, "Preliminaries"],
  [/^(?:methodology|methods?|approach|方法论?|研究方法)$/i, "Methodology"],
  [/^(?:model|architecture|模型|架构)$/i, "Model"],
  [/^(?:experiments?|实验)$/i, "Experiments"],
  [/^(?:results?|结果)$/i, "Results"],
  [/^(?:discussion|讨论)$/i, "Discussion"],
  [/^(?:conclusion|结论)$/i, "Conclusion"],
  [/^(?:limitations?|局限性)$/i, "Limitations"],
  [/^(?:future\s+work|未来工作)$/i, "Future Work"],
  [/^(?:acknowledgments?|致谢)$/i, "Acknowledgments"],
  [/^(?:references?|bibliography|参考文献)$/i, "References"],
  [/^(?:appendix(?:\s+[A-Z])?|附录)$/i, "Appendix"],
]

const HEADING_NUMBER_PREFIX_RE = /^(?:(?:\d+(?:\.\d+)*\.?|[IVXLC]+\.?)\s+)/i

function canonicalSectionTitle(raw: string): string {
  const title = raw.replace(HEADING_NUMBER_PREFIX_RE, "").replace(/\s*[:：]?\s*$/, "").trim()
  for (const [re, name] of KEYWORD_SECTION_MAP) {
    if (re.test(title)) return name
  }
  return title
}

export function detectSectionTitle(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  const md = trimmed.match(MARKDOWN_HEADING_RE)
  if (md) {
    const title = canonicalSectionTitle(md[2]!)
    return title || null
  }

  const numbered = trimmed.match(SECTION_HEADING_RE)
  if (numbered) {
    return canonicalSectionTitle(numbered[1]!)
  }

  return null
}

function normalizeLayoutLine(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function buildLinePageMap(blocks: LayoutTextBlock[]): Map<string, number | null> {
  const map = new Map<string, number | null>()
  for (const b of blocks) {
    const key = normalizeLayoutLine(b.text)
    if (key.length < 4) continue
    const existing = map.get(key)
    map.set(key, existing === undefined || existing === b.page ? b.page : null)
  }
  return map
}

function pageForLine(line: string, linePageMap: Map<string, number | null>): number | undefined {
  const mapped = linePageMap.get(normalizeLayoutLine(line))
  return typeof mapped === "number" ? mapped : undefined
}

type RawSection = {
  title: string
  lines: string[]
}

function splitIntoSections(text: string): RawSection[] {
  const lines = text.split(/\r?\n/)
  const sections: RawSection[] = []
  let current: RawSection = { title: "Preamble", lines: [] }

  for (const line of lines) {
    const section = detectSectionTitle(line)
    if (section && current.lines.length > 0) {
      sections.push(current)
      current = { title: section, lines: [line] }
    } else if (section) {
      current = { title: section, lines: [line] }
    } else {
      current.lines.push(line)
    }
  }

  if (current.lines.length) sections.push(current)
  if (!sections.length) sections.push({ title: "Document", lines })
  return sections
}

function splitSectionLines(
  lines: string[],
  linePageMap: Map<string, number | null>,
  maxChars = 2400
): Array<{ text: string; page?: number }> {
  const chunks: Array<{ text: string; page?: number }> = []
  let current: string[] = []
  let currentLength = 0
  let currentPage: number | undefined

  const flush = () => {
    const text = current.join("\n").trim()
    if (text) chunks.push({ text, ...(currentPage !== undefined ? { page: currentPage } : {}) })
    current = []
    currentLength = 0
    currentPage = undefined
  }

  for (const line of lines) {
    const linePage = pageForLine(line, linePageMap)
    if (current.length && linePage !== undefined && currentPage !== undefined && linePage !== currentPage) flush()
    if (currentPage === undefined && linePage !== undefined) currentPage = linePage

    if (line.length > maxChars) {
      flush()
      let remainder = line
      while (remainder.length > maxChars) {
        const window = remainder.slice(0, maxChars)
        const sentenceBreak = Math.max(window.lastIndexOf("。"), window.lastIndexOf(". "), window.lastIndexOf("; "), window.lastIndexOf("；"))
        const splitAt = sentenceBreak > maxChars * 0.55 ? sentenceBreak + 1 : maxChars
        chunks.push({ text: remainder.slice(0, splitAt).trim(), ...(linePage !== undefined ? { page: linePage } : {}) })
        remainder = remainder.slice(splitAt).trimStart()
      }
      if (remainder) {
        current = [remainder]
        currentLength = remainder.length
        currentPage = linePage
      }
      continue
    }

    const nextLength = currentLength + line.length + (current.length ? 1 : 0)
    if (current.length && nextLength > maxChars) flush()
    current.push(line)
    currentLength += line.length + (current.length > 1 ? 1 : 0)
  }

  flush()
  return chunks
}

function mergeTinySections(sections: RawSection[], minChars = 80): RawSection[] {
  if (sections.length <= 1) return sections
  const merged: RawSection[] = []
  for (const sec of sections) {
    const body = sec.lines.join("\n").trim()
    const isNamedSection = sec.title !== "Preamble" && sec.title !== "Document"
    if (body.length < minChars && merged.length && !isNamedSection) {
      const prev = merged[merged.length - 1]!
      prev.lines.push(...sec.lines)
    } else {
      merged.push({ ...sec, lines: [...sec.lines] })
    }
  }
  return merged
}

export type SemanticChunkInput = {
  text: string
  blocks?: LayoutTextBlock[]
  pageGeometries?: PageGeometry[]
}

/**
 * 基于 Markdown 标题 / 论文章节关键词的语义切片。
 * 不使用固定 Token 步长截断；每个 Chunk 对应完整学术段落。
 */
export function semanticChunkAcademicText(input: SemanticChunkInput): AcademicChunk[] {
  const normalized = input.text.replace(/\r\n/g, "\n").trim()
  if (!normalized) return []

  const linePageMap = buildLinePageMap(input.blocks ?? [])
  const sections = mergeTinySections(splitIntoSections(normalized))
  const chunks: AcademicChunk[] = []

  for (const section of sections) {
    for (const chunk of splitSectionLines(section.lines, linePageMap)) {
      chunks.push(AcademicChunkSchema.parse({
        text: chunk.text,
        metadata: { section: section.title, ...(chunk.page !== undefined ? { page: chunk.page } : {}), index: chunks.length },
      }))
    }
  }

  return AcademicChunkArraySchema.parse(chunks)
}

/** 将语义切片格式化为 Peer Review / RAG 上下文块。 */
export function formatAcademicChunksForContext(chunks: AcademicChunk[], maxChunks = 12): string {
  const selected = chunks.slice(0, maxChunks)
  if (!selected.length) return ""

  const lines = selected.map((c) => {
    const pageTag = c.metadata.page ? ` (p.${c.metadata.page})` : ""
    return [`## [${c.metadata.section}${pageTag}]`, c.text.trim(), ""].join("\n")
  })
  return ["[学术语义切片 — 按章节边界切割，含 LaTeX 公式]", ...lines, "---", ""].join("\n")
}

export function parseAcademicChunks(raw: unknown): AcademicChunk[] {
  return AcademicChunkArraySchema.parse(raw)
}
