import { marked } from "marked"
import TurndownService from "turndown"

marked.setOptions({ gfm: true, breaks: true })

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" })

turndown.addRule("strikethrough", {
  filter: ["del", "s"],
  replacement: (content) => `~~${content}~~`,
})

export function markdownToHtml(markdown: string): string {
  const md = markdown.trim()
  if (!md) return "<p></p>"
  return marked.parse(md, { async: false }) as string
}

export function htmlToMarkdown(html: string): string {
  const trimmed = html.trim()
  if (!trimmed || trimmed === "<p></p>") return ""
  return turndown.turndown(trimmed).trim()
}
