import katex from "katex"
import { marked } from "marked"
import TurndownService from "turndown"
import { normalizeReferenceSections } from "./reference-sections"

marked.setOptions({ gfm: true, breaks: true })

// ── HTML 纵深防御（SK-75）─────────────────────────────────────────
// marked.parse 默认允许原始 HTML 透传。对话内容来自用户输入与 LLM 输出，
// 任何调用方漏了外层净化就会让 <img onerror=...> / <script> 直接执行。
// 这里在 markdownToHtml / markdownToCanvasHtml 内部做基础剥离，使函数
// 「默认安全」；导出路径的 sanitizeExportHtml 仍做更彻底的二次净化。
const DANGER_PAIRED_RE =
  /<\s*(script|style|iframe|object|embed|form)\b[\s\S]*?<\s*\/\s*(script|style|iframe|object|embed|form)\s*>/gi
const DANGER_STRAY_RE = /<\/?\s*(script|style|iframe|object|embed|form|link|meta|base)\b[^>]*>/gi
const EVENT_ATTR_RE = /(?<![a-z0-9_-])on[a-z]{3,}\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi
const URL_ATTR_RE =
  /(\s(?:href|src|xlink:href|formaction|action)\s*=\s*)("(?:[^"]*)"|'(?:[^']*)'|[^\s>]+)/gi
const SAFE_URL_SCHEMES = new Set(["http", "https", "mailto", "tel"])

function isUnsafeUrl(raw: string): boolean {
  const unquoted = raw.replace(/^["']/, "").replace(/["']$/, "").trim()
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(unquoted)
  if (!m) return false
  return !SAFE_URL_SCHEMES.has(m[1]!.toLowerCase())
}

/** 剥离已知执行面：危险标签、事件属性、javascript:/data: URL。 */
function stripDangerousHtml(html: string): string {
  return html
    .replace(DANGER_PAIRED_RE, "")
    .replace(DANGER_STRAY_RE, "")
    .replace(URL_ATTR_RE, (whole, _lead: string, rawValue: string) =>
      isUnsafeUrl(rawValue) ? "" : whole
    )
    .replace(EVENT_ATTR_RE, "")
}

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
  return stripDangerousHtml(marked.parse(md, { async: false }) as string)
}

/** Scholar Canvas: Markdown + LaTeX delimiters → HTML for TipTap. */
export function markdownToCanvasHtml(markdown: string): string {
  const md = normalizeReferenceSections(markdown).trim()
  if (!md) return "<p></p>"
  return stripDangerousHtml(
    marked.parse(injectCanvasMathDelimiters(md), { async: false }) as string
  )
}

export function htmlToMarkdown(html: string): string {
  const trimmed = html.trim()
  if (!trimmed || trimmed === "<p></p>") return ""
  return turndown.turndown(trimmed).trim()
}
