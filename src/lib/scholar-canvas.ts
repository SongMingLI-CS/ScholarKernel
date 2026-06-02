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

/** Chat bubble placeholder when canvas body is routed to the side panel. */
export function buildCanvasChatPlaceholder(title: string, lang: Lang, streaming = false): string {
  const safeTitle = title.trim() || (lang === "zh" ? "未命名文档" : "Untitled")
  if (lang === "zh") {
    return streaming
      ? `📝 **正在右侧工作区为您撰写《${safeTitle}》的详细综述，请稍候…**`
      : `📝 **已在右侧工作区为您生成《${safeTitle}》的详细综述，请查阅并编辑。**`
  }
  return streaming
    ? `📝 **Drafting «${safeTitle}» in the workspace — please wait…**`
    : `📝 **«${safeTitle}» is ready in the workspace — review and edit on the right.**`
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
