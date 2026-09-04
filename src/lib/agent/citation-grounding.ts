const REFERENCES_HEADING_RE = /^#{1,3}\s*(?:参考文献|references?)(?:\s*\([^\n]*\))?\s*$/im

/**
 * 最终参考文献只允许来自检索工具的确定性结果。
 * 模型仍负责正文中的 [n] 标注，但不能自行扩写标题或 URL。
 */
export function composeGroundedFinal(modelText: string, citationsMarkdown: string): string {
  const text = modelText.trim()
  const heading = REFERENCES_HEADING_RE.exec(text)
  const withoutGeneratedReferences = (heading ? text.slice(0, heading.index) : text).trim()
  const groundedReferences = citationsMarkdown.trim()

  return [withoutGeneratedReferences, groundedReferences].filter(Boolean).join("\n\n")
}
