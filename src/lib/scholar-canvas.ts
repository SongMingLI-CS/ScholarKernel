/** Scholar Canvas XML tag intercept — long-form academic artifacts rendered in the side panel. */

import type { Lang } from "@/store/types"

export const SCHOLAR_CANVAS_OUTPUT_DISCIPLINE = [
  "【学术工坊 Scholar Canvas】",
  "当你被要求撰写长篇综述、研究报告、完整代码实现或结构化长文时，",
  "请使用 `<scholar-canvas title=\"文档标题\">你的长篇 Markdown 内容</scholar-canvas>` 包裹输出，",
  "以便在用户的独立工作台中展示；标签外可保留简短说明。",
  "",
  "当你被要求输出到 `<scholar-canvas>` 时，你必须采取博士级别的严谨度。",
  "不仅要提供宏观概括，还必须深入到：算法复杂度（如 $O(N)$ 等）、具体网络层级设计对比、",
  "以及真实场景的性能指标权衡。拒绝泛泛而谈的表层对比。",
].join("\n")

export type CanvasChatCardPayload = {
  title: string
  charCount: number
  streaming: boolean
}

export type BubbleContentSegment =
  | { type: "markdown"; text: string }
  | { type: "canvas-card"; card: CanvasChatCardPayload }

const CANVAS_CARD_RE = /⟦SK_CANVAS:({[\s\S]*?})⟧/g

function defaultCanvasTitle(lang: Lang): string {
  return lang === "zh" ? "未命名文档" : "Untitled"
}

/** Machine-readable chat bubble marker; rendered as CanvasChatPlaceholderCard in UI. */
export function serializeCanvasChatCard(card: CanvasChatCardPayload): string {
  return `⟦SK_CANVAS:${JSON.stringify(card)}⟧`
}

export function parseBubbleContentSegments(content: string): BubbleContentSegment[] {
  const segments: BubbleContentSegment[] = []
  let lastIndex = 0
  const re = new RegExp(CANVAS_CARD_RE.source, "g")
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index).trim()
    if (before) segments.push({ type: "markdown", text: before })
    try {
      const parsed = JSON.parse(match[1] ?? "{}") as Partial<CanvasChatCardPayload>
      segments.push({
        type: "canvas-card",
        card: {
          title: String(parsed.title ?? "").trim() || "未命名文档",
          charCount: Math.max(0, Number(parsed.charCount) || 0),
          streaming: Boolean(parsed.streaming),
        },
      })
    } catch {
      /* skip malformed card */
    }
    lastIndex = match.index + match[0].length
  }
  const tail = content.slice(lastIndex).trim()
  if (tail) segments.push({ type: "markdown", text: tail })
  return segments
}

export function bubbleContentHasCanvasCard(content: string): boolean {
  return /⟦SK_CANVAS:/.test(content)
}

/** Plain-text fallback for copy/export when bubble contains canvas cards. */
export function canvasCardToPlainText(card: CanvasChatCardPayload, lang: Lang): string {
  const title = card.title.trim() || defaultCanvasTitle(lang)
  if (lang === "zh") {
    return card.streaming
      ? `正在右侧学术工坊撰写《${title}》（${card.charCount} 字）…`
      : `《${title}》已生成至右侧学术工坊（${card.charCount} 字）。`
  }
  return card.streaming
    ? `Drafting «${title}» in Scholar Canvas (${card.charCount} chars)…`
    : `«${title}» is in Scholar Canvas (${card.charCount} chars).`
}

export function bubbleContentToPlainText(content: string, lang: Lang): string {
  const segments = parseBubbleContentSegments(content)
  if (segments.length === 0) return content
  return segments
    .map((s) => (s.type === "canvas-card" ? canvasCardToPlainText(s.card, lang) : s.text))
    .filter(Boolean)
    .join("\n\n")
}

/** Chat bubble placeholder when canvas body is routed to the side panel. */
export function buildCanvasChatPlaceholder(
  title: string,
  lang: Lang,
  streaming = false,
  charCount = 0
): string {
  const safeTitle = title.trim() || defaultCanvasTitle(lang)
  return serializeCanvasChatCard({
    title: safeTitle,
    charCount: Math.max(0, charCount),
    streaming,
  })
}

const CANVAS_OPEN_RE = /<scholar-canvas\s+title="([^"]*)"\s*>/i
const CANVAS_CLOSE_RE = /<\/scholar-canvas>/i
const CANVAS_BLOCK_RE = /<scholar-canvas[\s\S]*?(?:<\/scholar-canvas>|$)/gi

export type ScholarCanvasExtract = {
  title: string
  content: string
  cleanedText: string
  hasCompleteTag: boolean
}

export function stripScholarCanvasBlocks(raw: string): string {
  return raw.replace(CANVAS_BLOCK_RE, "").replace(/\n{3,}/g, "\n\n").trim()
}

export function interceptScholarCanvasInAssistantBubble(raw: string): ScholarCanvasExtract | null {
  const openMatch = CANVAS_OPEN_RE.exec(raw)
  if (!openMatch) return null

  const title = (openMatch[1] ?? "").trim() || "未命名文档"
  const contentStart = (openMatch.index ?? 0) + openMatch[0].length
  const tail = raw.slice(contentStart)
  const closeMatch = CANVAS_CLOSE_RE.exec(tail)
  const content = (closeMatch ? tail.slice(0, closeMatch.index) : tail).trim()
  const cleanedText = stripScholarCanvasBlocks(raw)

  return {
    title,
    content,
    cleanedText,
    hasCompleteTag: Boolean(closeMatch),
  }
}
