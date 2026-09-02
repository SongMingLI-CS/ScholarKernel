import katex from "katex"
import { marked } from "marked"
import TurndownService from "turndown"

import { injectPageCitationAnchors } from "@/lib/page-citation"

marked.setOptions({ gfm: true, breaks: true })

function renderKatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex.trim(), {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      output: "html",
    })
  } catch {
    return displayMode ? `$$${tex}$$` : `$${tex}$`
  }
}

/** Inject KaTeX HTML for $...$ / $$...$$ before Markdown → HTML (Scholar Canvas). */
export function injectCanvasMathDelimiters(markdown: string): string {
  let out = markdown
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => {
    const html = renderKatex(tex, true)
    return `\n<div class="katex-display sk-canvas-math-block">${html}</div>\n`
  })
  out = out.replace(/(?<!\$)\$(?!\$)([^\$\n]+?)\$(?!\$)/g, (_, tex: string) => {
    const html = renderKatex(tex, false)
    return `<span class="katex-inline sk-canvas-math-inline">${html}</span>`
  })
  return out
}

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

/** Scholar Canvas: Markdown + LaTeX delimiters + page citations → HTML for TipTap. */
export function markdownToCanvasHtml(markdown: string): string {
  const md = markdown.trim()
  if (!md) return "<p></p>"
  const withMath = injectCanvasMathDelimiters(md)
  const withCitations = injectPageCitationAnchors(withMath)
  return marked.parse(withCitations, { async: false }) as string
}

export function htmlToMarkdown(html: string): string {
  const trimmed = html.trim()
  if (!trimmed || trimmed === "<p></p>") return ""
  return turndown.turndown(trimmed).trim()
}
