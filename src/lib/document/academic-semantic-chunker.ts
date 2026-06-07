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
  /^(?:#{1,3}\s+)?(?:(?:\d+(?:\.\d+)*\.?\s+)|(?:[IVXLC]+\.\s+))?(Abstract|Introduction|Related\s+Work|Background|Preliminaries|Methodology|Methods|Approach|Model|Architecture|Experiments?|Results?|Discussion|Conclusion|Limitations|Future\s+Work|Acknowledgments?|References?|Bibliography|Appendix(?:\s+[A-Z])?)\b/i

const MARKDOWN_HEADING_RE = /^(#{1,3})\s+(.+)$/

const KEYWORD_SECTION_MAP: Array<[RegExp, string]> = [
  [/^abstract\b/i, "Abstract"],
  [/^introduction\b/i, "Introduction"],
  [/^related\s+work\b/i, "Related Work"],
  [/^background\b/i, "Background"],
  [/^methodology\b|^methods\b|^approach\b/i, "Methodology"],
  [/^experiments?\b/i, "Experiments"],
  [/^results?\b/i, "Results"],
  [/^discussion\b/i, "Discussion"],
  [/^conclusion\b/i, "Conclusion"],
  [/^references?\b|^bibliography\b/i, "References"],
  [/^appendix\b/i, "Appendix"],
]

export function detectSectionTitle(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  const md = trimmed.match(MARKDOWN_HEADING_RE)
  if (md) {
    const title = md[2]!.trim()
    for (const [re, name] of KEYWORD_SECTION_MAP) {
      if (re.test(title)) return name
    }
    return title.replace(/^\d+(?:\.\d+)*\.?\s+/, "").trim() || title
  }

  const numbered = trimmed.match(SECTION_HEADING_RE)
  if (numbered) {
    const raw = numbered[1]!
    for (const [re, name] of KEYWORD_SECTION_MAP) {
      if (re.test(raw)) return name
    }
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
  }

  return null
}

function buildLinePageMap(blocks: LayoutTextBlock[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const b of blocks) {
    const key = b.text.trim()
    if (key.length >= 4 && !map.has(key)) map.set(key, b.page)
  }
  return map
}

function inferPageForText(text: string, linePageMap: Map<string, number>, fallback = 1): number {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (const line of lines) {
    if (line.length < 4) continue
    const direct = linePageMap.get(line)
    if (direct) return direct
    for (const [key, page] of linePageMap) {
      if (line.includes(key) || key.includes(line)) return page
    }
  }
  return fallback
}

function estimatePageFromOffset(
  charOffset: number,
  totalChars: number,
  pageGeometries: PageGeometry[]
): number | undefined {
  if (!pageGeometries.length || totalChars <= 0) return undefined
  const pages = pageGeometries.length
  const ratio = charOffset / totalChars
  return Math.min(pages, Math.max(1, Math.ceil(ratio * pages)))
}

type RawSection = {
  title: string
  lines: string[]
  startOffset: number
}

function splitIntoSections(text: string): RawSection[] {
  const lines = text.split(/\r?\n/)
  const sections: RawSection[] = []
  let current: RawSection = { title: "Preamble", lines: [], startOffset: 0 }
  let offset = 0

  for (const line of lines) {
    const section = detectSectionTitle(line)
    if (section && current.lines.length > 0) {
      sections.push(current)
      current = { title: section, lines: [line], startOffset: offset }
    } else if (section) {
      current = { title: section, lines: [line], startOffset: offset }
    } else {
      current.lines.push(line)
    }
    offset += line.length + 1
  }

  if (current.lines.length) sections.push(current)
  if (!sections.length) sections.push({ title: "Document", lines, startOffset: 0 })
  return sections
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

  sections.forEach((sec, index) => {
    const body = sec.lines.join("\n").trim()
    if (!body) return

    const page =
      inferPageForText(body, linePageMap) ??
      estimatePageFromOffset(sec.startOffset, normalized.length, input.pageGeometries ?? [])

    chunks.push(
      AcademicChunkSchema.parse({
        text: body,
        metadata: {
          section: sec.title,
          ...(page ? { page } : {}),
          index,
        },
      })
    )
  })

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
