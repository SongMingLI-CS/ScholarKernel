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

/** 标题行长度上限：超过这个长度的行是正文，不是标题。 */
const MAX_SECTION_HEADING_CHARS = 80
/** 关键字之后的残余长度上限：标题在关键字之后只允许「A」「I」这类编号。 */
const MAX_SECTION_HEADING_TAIL_CHARS = 40
/** 句末/分句标点：正文句子才有，标题不该有。 */
const SENTENCE_END_RE = /[.。!?！？;；,，]$/

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

/**
 * 中文章节关键字。注意两点：
 *
 * 1. 不能用 `\b` 收尾 —— `\w` 只含 `[A-Za-z0-9_]`，CJK 不构成词边界，
 *    `(摘要)\b` 永远不会匹配（与 SK-33 同一根因）。
 * 2. 复合词要长的在前，「实验结果」先于「实验」，否则只会命中前半截。
 */
const ZH_SECTION_KEYWORDS = [
  "摘要",
  "引言",
  "绪论",
  "前言",
  "相关工作",
  "研究背景",
  "背景",
  "方法学",
  "方法",
  "实验结果",
  "实验",
  "结果",
  "讨论",
  "结论",
  "总结",
  "参考文献",
  "致谢",
  "附录",
] as const

const ZH_SECTION_MAP: Array<[RegExp, string]> = [
  [/^摘要/, "Abstract"],
  [/^引言|^绪论|^前言/, "Introduction"],
  [/^相关工作/, "Related Work"],
  [/^研究背景|^背景/, "Background"],
  [/^方法学|^方法/, "Methodology"],
  [/^实验结果|^实验/, "Experiments"],
  [/^结果/, "Results"],
  [/^讨论/, "Discussion"],
  [/^结论|^总结/, "Conclusion"],
  [/^参考文献/, "References"],
  [/^致谢/, "Acknowledgments"],
  [/^附录/, "Appendix"],
]

const ZH_SECTION_HEADING_RE = new RegExp(
  `^(?:#{1,3}\\s+)?(?:(?:\\d+(?:\\.\\d+)*\\.?\\s*)|(?:[IVXLC]+\\.\\s+))?(${ZH_SECTION_KEYWORDS.join("|")})`
)

/** 中文标题的总长度上限：学术正文行几乎都超过这个长度。 */
const ZH_MAX_SECTION_HEADING_CHARS = 24
/** 中文标题内不该出现的句读标点（允许 `.`，因为「3.1 模型结构」需要它）。 */
const ZH_INNER_PUNCT_RE = /[，。；：、]/

function matchSectionKeyword(text: string): string | null {
  for (const [re, name] of KEYWORD_SECTION_MAP) {
    if (re.test(text)) return name
  }
  for (const [re, name] of ZH_SECTION_MAP) {
    if (re.test(text)) return name
  }
  return null
}

export function detectSectionTitle(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  const md = trimmed.match(MARKDOWN_HEADING_RE)
  if (md) {
    const title = md[2]!.trim()
    const known = matchSectionKeyword(title)
    if (known) return known
    return title.replace(/^\d+(?:\.\d+)*\.?\s+/, "").trim() || title
  }

  // 非 Markdown 行必须通过三项「像标题」的判据，否则把正文首词当章节名会切碎全文：
  //   1) 足够短；2) 不以句末标点结尾；3) 关键字之后几乎没有残余文本。
  if (trimmed.length > MAX_SECTION_HEADING_CHARS) return null
  if (SENTENCE_END_RE.test(trimmed)) return null

  const numbered = trimmed.match(SECTION_HEADING_RE)
  if (numbered) {
    const tail = trimmed.slice(numbered[0].length).trim()
    if (tail.length > MAX_SECTION_HEADING_TAIL_CHARS) return null

    const name = matchSectionKeyword(numbered[1]!)
    if (name) return name
    return numbered[1]!.charAt(0).toUpperCase() + numbered[1]!.slice(1).toLowerCase()
  }

  // 中文标题没有空格、也无法靠 `\b` 收尾，改用「短行 + 无句读标点」判定
  if (trimmed.length > ZH_MAX_SECTION_HEADING_CHARS) return null
  if (ZH_INNER_PUNCT_RE.test(trimmed)) return null
  const zh = trimmed.match(ZH_SECTION_HEADING_RE)
  if (!zh) return null
  return matchSectionKeyword(zh[1]!)
}

function buildLinePageMap(blocks: LayoutTextBlock[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const b of blocks) {
    const key = b.text.trim()
    if (key.length >= 4 && !map.has(key)) map.set(key, b.page)
  }
  return map
}

function inferPageForText(text: string, linePageMap: Map<string, number>): number | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (const line of lines) {
    if (line.length < 4) continue
    const direct = linePageMap.get(line)
    if (direct) return direct
    for (const [key, page] of linePageMap) {
      if (line.includes(key) || key.includes(line)) return page
    }
  }
  return undefined
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

    // 优先级：坐标块命中的真实页码 → 按字符偏移估算 → 未知时回落第 1 页
    const page =
      inferPageForText(body, linePageMap) ??
      estimatePageFromOffset(sec.startOffset, normalized.length, input.pageGeometries ?? []) ??
      1

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

/** 没有正文信息量的章节：参考文献表、致谢、附录。它们不该占用上下文预算。 */
const NOISE_SECTIONS = new Set(["References", "Acknowledgments", "Appendix", "参考文献", "致谢", "附录"])

/**
 * 按预算挑选切片。
 *
 * 原实现是 `chunks.slice(0, maxChunks)` —— 只留文档**头部**。一篇 22 个切片的论文，
 * Discussion / Conclusion 永远进不了上下文，于是「这篇论文的结论是什么」这类
 * 最常见的问题必然答不上来；而 References 只要落在前 12 个里就照样占名额。
 *
 * 三条规则，顺序很重要：
 * 1. **装得下就原样全给**。噪声过滤只在「必须挑」时才允许丢东西 ——
 *    否则文档里若出现一个 References 标题，它后面的正文会被整段误删
 *    （拼接论文、附录里放正文的情况真实存在）。
 * 2. 需要截断时优先用有信息量的章节；若噪声章节占多数，退回原文再截。
 * 3. 截断固定保留**末尾 2 个**（结论/讨论通常在文档尾部），其余名额给头部；
 *    输出仍按原文顺序，读起来像一篇论文而不是拼贴。
 */
export function selectContextChunks(chunks: AcademicChunk[], maxChunks = 12): AcademicChunk[] {
  if (maxChunks <= 0) return []
  if (chunks.length <= maxChunks) return chunks

  const contentful = chunks.filter((c) => !NOISE_SECTIONS.has(c.metadata.section))
  const pool = contentful.length >= maxChunks ? contentful : chunks
  if (pool.length <= maxChunks) return pool

  const tailCount = Math.min(2, Math.floor(maxChunks / 2))
  const headCount = maxChunks - tailCount
  return [...pool.slice(0, headCount), ...pool.slice(pool.length - tailCount)]
}

/** 将语义切片格式化为 Peer Review / RAG 上下文块。 */
export function formatAcademicChunksForContext(chunks: AcademicChunk[], maxChunks = 12): string {
  const selected = selectContextChunks(chunks, maxChunks)
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
