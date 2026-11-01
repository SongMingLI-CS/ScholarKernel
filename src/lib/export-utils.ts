import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx"

import { looksLikeWorkflowPlanJson } from "@/lib/chat-bubble-utils"
import { formatConversationAsMarkdown } from "@/lib/conversation-utils"
import type { ExportMetadata } from "@/lib/export-metadata"
import { buildExportMetadataHtml, prependExportMetadata } from "@/lib/export-metadata"
import { markdownToHtml } from "@/lib/markdown-bridge"
import type { ChatMessage } from "@/store/useAgentStore"
import type { Lang } from "@/store/types"

type InlinePart = { text: string; bold?: boolean; italic?: boolean }

const CODE_FONT = "Consolas"
/** docx 的 size 单位是半磅：18 = 9pt。 */
const CODE_FONT_SIZE = 18
const QUOTE_COLOR = "555555"

/**
 * 围栏：``` 或 ~~~，可带 info string（```python / ```js title="x"）。
 * info string 里若有反引号，说明这行其实是行内代码（```` ```x``` ````），
 * 不能当围栏 —— 否则会把后面的全文都吞进代码块。
 */
const FENCE_RE = /^(`{3,}|~{3,})\s*([^`~]*)$/
/** 引用：最多 3 个前导空格 + 一个或多个 `>`。 */
const QUOTE_PREFIX_RE = /^\s{0,3}(?:>\s?)+/
const QUOTE_LINE_RE = /^\s{0,3}>/
/** 分隔线：`---` / `***` / `___`（允许符号间空格）。 */
const RULE_RE = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/

function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) })
    const token = m[0]
    if (token.startsWith("**") || token.startsWith("__")) {
      parts.push({ text: token.slice(2, -2), bold: true })
    } else {
      parts.push({ text: token.slice(1, -1), italic: true })
    }
    last = m.index + token.length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts.length ? parts : [{ text }]
}

type RunStyle = { color?: string; size?: number; font?: string; italics?: boolean }

/** `**x**` / `*x*` → 带样式的 run 列表；样式参数用于整块统一（引用、代码）。 */
function inlineRuns(text: string, style?: RunStyle): TextRun[] {
  return parseInline(text).map(
    (p) =>
      new TextRun({
        text: p.text,
        bold: p.bold,
        italics: p.italic || style?.italics,
        color: style?.color,
        size: style?.size,
        font: style?.font,
      })
  )
}

function inlineParagraph(text: string, opts?: { heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel] }) {
  const runs = inlineRuns(text)
  return new Paragraph({
    heading: opts?.heading,
    children: runs.length ? runs : [new TextRun("")],
    spacing: { after: 120 },
  })
}

/**
 * 代码块：每行一段，等宽字体，**不裁掉前导空白**。
 *
 * 之前没有围栏分支，```` ```python ```` 与 `    if n < 2:` 都会走到正文分支：
 * 围栏标记原样进 Word，而 `trimmed` 把缩进吃掉一半 —— Python 的缩进是语义，
 * 导出后代码直接不可读。
 */
function codeParagraphs(codeLines: string[]): Paragraph[] {
  if (!codeLines.length) return [new Paragraph({ children: [new TextRun("")] })]
  return codeLines.map(
    (line) =>
      new Paragraph({
        children: [new TextRun({ text: line, font: CODE_FONT, size: CODE_FONT_SIZE })],
        spacing: { after: 0, line: 240 },
        indent: { left: 240 },
      })
  )
}

/**
 * 引用块：去掉 `>` 标记，用左缩进 + 灰色斜体表达。
 * Word 没有块引用样式；而导出元数据头（`> 模型：…`）正是引用块形式，
 * 不处理就会在每份带元数据的文档顶部留下字面 `>`。
 */
function quoteParagraph(quoteLines: string[]): Paragraph {
  const runs: TextRun[] = []
  quoteLines.forEach((line, idx) => {
    const parts = inlineRuns(line, { color: QUOTE_COLOR, italics: true })
    const first = parts[0] ?? new TextRun({ text: "" })
    if (idx > 0) runs.push(new TextRun({ break: 1 }))
    runs.push(first)
    runs.push(...parts.slice(1))
  })
  return new Paragraph({
    children: runs.length ? runs : [new TextRun("")],
    spacing: { after: 120 },
    indent: { left: 480 },
  })
}

function ruleParagraph(): Paragraph {
  return new Paragraph({
    children: [new TextRun("")],
    spacing: { after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 1 } },
  })
}

function isTableRow(line: string) {
  const t = line.trim()
  return t.startsWith("|") && t.endsWith("|") && t.includes("|")
}

function isTableSeparator(line: string) {
  return /^\|?[\s\-:|]+\|?$/.test(line.trim())
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim())
}

function tableFromRows(rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (cells, rowIdx) =>
        new TableRow({
          children: cells.map(
            (cell) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: parseInline(cell).map(
                      (p) =>
                        new TextRun({
                          text: p.text,
                          bold: p.bold || rowIdx === 0,
                          italics: p.italic,
                        })
                    ),
                  }),
                ],
              })
          ),
        })
    ),
  })
}

function headingLevel(depth: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  if (depth <= 1) return HeadingLevel.HEADING_1
  if (depth === 2) return HeadingLevel.HEADING_2
  if (depth === 3) return HeadingLevel.HEADING_3
  return HeadingLevel.HEADING_4
}

/** Convert Markdown to a native Word (.docx) blob. */
export async function exportMarkdownAsDocx(
  title: string,
  markdown: string,
  meta?: ExportMetadata,
  lang: Lang = "zh"
): Promise<Blob> {
  const md = meta ? prependExportMetadata(markdown, meta, lang) : markdown
  const lines = md.replace(/\r\n/g, "\n").split("\n")
  const children: Array<Paragraph | Table> = []

  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: title.trim() || "Scholar Canvas", bold: true })],
      spacing: { after: 240 },
    })
  )

  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ""
    const trimmed = line.trim()

    if (!trimmed) {
      i += 1
      continue
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      children.push(inlineParagraph(heading[2]!, { heading: headingLevel(heading[1]!.length) }))
      i += 1
      continue
    }

    const fence = trimmed.match(FENCE_RE)
    if (fence) {
      const marker = fence[1] ?? "```"
      const closeRe = new RegExp(`^\\s*${marker[0] === "~" ? "~" : "`"}{${marker.length},}\\s*$`)
      i += 1
      const codeLines: string[] = []
      while (i < lines.length) {
        const raw = lines[i] ?? ""
        if (closeRe.test(raw)) {
          i += 1
          break
        }
        // 保留前导空白（缩进即语义），只裁掉行尾多余空白
        codeLines.push(raw.replace(/\t/g, "    ").replace(/[ \t]+$/, ""))
        i += 1
      }
      children.push(...codeParagraphs(codeLines))
      continue
    }

    if (isTableRow(trimmed)) {
      const tableRows: string[][] = []
      while (i < lines.length && isTableRow(lines[i] ?? "")) {
        if (!isTableSeparator(lines[i] ?? "")) tableRows.push(parseTableRow(lines[i] ?? ""))
        i += 1
      }
      if (tableRows.length) children.push(tableFromRows(tableRows))
      continue
    }

    if (QUOTE_LINE_RE.test(line)) {
      const quoteLines: string[] = []
      while (i < lines.length && QUOTE_LINE_RE.test(lines[i] ?? "")) {
        quoteLines.push((lines[i] ?? "").replace(QUOTE_PREFIX_RE, ""))
        i += 1
      }
      children.push(quoteParagraph(quoteLines))
      continue
    }

    if (RULE_RE.test(trimmed)) {
      children.push(ruleParagraph())
      i += 1
      continue
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const itemText = trimmed.replace(/^[-*+]\s+/, "")
      const runs = inlineRuns(itemText)
      children.push(
        new Paragraph({
          children: [new TextRun({ text: "• " }), ...runs],
          spacing: { after: 80 },
          indent: { left: 360 },
        })
      )
      i += 1
      continue
    }

    children.push(inlineParagraph(trimmed))
    i += 1
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  })

  return Packer.toBlob(doc)
}

/** Trigger browser download of a Word document generated from Markdown. */
export async function downloadMarkdownAsDocx(
  filename: string,
  title: string,
  markdown: string,
  meta?: ExportMetadata,
  lang: Lang = "zh"
) {
  const blob = await exportMarkdownAsDocx(title, markdown, meta, lang)
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename.endsWith(".docx") ? filename : `${filename.replace(/\.(md|doc)$/i, "")}.docx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const EXPORT_ROLE_LABEL: Record<ChatMessage["role"], string> = {
  user: "用户",
  assistant: "助手",
  system: "系统",
}

/** Strip workflow plan JSON and other internal noise from conversation exports. */
export function isInternalExportNoise(content: string): boolean {
  const c = content.trim()
  if (!c) return true
  if (looksLikeWorkflowPlanJson(c)) return true
  if (/^\s*```(?:json)?\s*[\[{]/i.test(c)) return true
  if (c.startsWith("{") && c.includes('"tasks"') && c.length > 400 && !c.includes("\n")) return true
  return false
}

export function filterExportableMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => {
    if (m.role === "system" && !m.content.trim()) return false
    if (m.role !== "system" && isInternalExportNoise(m.content)) return false
    return true
  })
}

/** Export a conversation transcript as a native Word (.docx) blob. */
export async function exportConversationAsDocx(
  title: string,
  messages: ChatMessage[],
  meta?: ExportMetadata,
  lang: Lang = "zh"
): Promise<Blob> {
  const filtered = filterExportableMessages(messages)
  const md = formatConversationAsMarkdown(title, filtered, meta, lang)
  return exportMarkdownAsDocx(title, md)
}

export async function downloadConversationAsDocx(
  filename: string,
  title: string,
  messages: ChatMessage[],
  meta?: ExportMetadata,
  lang: Lang = "zh"
) {
  const blob = await exportConversationAsDocx(title, messages, meta, lang)
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename.endsWith(".docx") ? filename : `${filename.replace(/\.(md|doc)$/i, "")}.docx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * 引用链接的协议白名单。只放行绝对 http(s)。
 * 导出文件会被用户下载、用浏览器打开，`javascript:` / `data:text/html` 必须挡掉。
 */
function safeHref(raw: string | undefined): string | null {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return null
  if (!/^https?:\/\//i.test(trimmed)) return null
  return trimmed
}

const BLOCKED_PAIRED_TAG_RE =
  /<\s*(script|style|iframe|object|embed|form)\b[\s\S]*?<\s*\/\s*(script|style|iframe|object|embed|form)\s*>/gi
const BLOCKED_STRAY_TAG_RE = /<\/?\s*(script|style|iframe|object|embed|form|link|meta|base)\b[^>]*>/gi
/**
 * 事件属性：不要求前面是空格。
 *
 * HTML 里 `<svg/onload=...>` 与 `<svg onload=...>` 解析结果相同，
 * `<a href="/x"onclick=...>` 也一样 —— 旧规则 `\son[a-z]+` 要求空格，两种写法都能绕过。
 */
const EVENT_ATTR_RE = /(?<![a-z0-9_-])on[a-z]{3,}\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi

/**
 * 承载 URL 的属性。`formaction` / `action` 必须在内：
 * `<button formaction="javascript:…">` 点一下就会执行，而 `button` 不在危险标签
 * 黑名单里、也没有事件属性 —— 于是 `formaction` 曾是全链路上唯一没被检查的 URL 通道。
 * 不列 `data`：`data-*` 是普通自定义属性，误剥离会破坏正文。
 */
const URL_ATTR_RE = /(\s(?:href|src|xlink:href|formaction|action)\s*=\s*)("(?:[^"]*)"|'(?:[^']*)'|[^\s>]+)/gi

const SAFE_URL_SCHEMES = new Set(["http", "https", "mailto", "tel"])
const NAMED_URL_ENTITY: Record<string, string> = { colon: ":", tab: "\t", newline: "\n", amp: "&" }

function fromCodePoint(code: number, fallback: string): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return fallback
  try {
    return String.fromCodePoint(code)
  } catch {
    return fallback
  }
}

/**
 * 解码属性值里的实体。
 *
 * 浏览器在解析 `href` 前会先解实体，`&#106;avascript:` 与 `javascript:` 等价；
 * 只认字面量的黑名单必然被编码绕过。
 */
function decodeUrlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (m, hex: string) => fromCodePoint(Number.parseInt(hex, 16), m))
    .replace(/&#(\d+);?/g, (m, dec: string) => fromCodePoint(Number.parseInt(dec, 10), m))
    .replace(/&(colon|tab|newline|amp);?/gi, (m, name: string) => NAMED_URL_ENTITY[name.toLowerCase()] ?? m)
}

/**
 * URL 属性改用协议白名单：不再枚举危险协议，而是「只放行已知安全协议」。
 * 相对链接与锚点没有协议头，直接放行。
 * `data:` 只放行位图类型 —— `data:image/svg+xml` 内部可执行脚本。
 */
function isUnsafeUrl(value: string): boolean {
  const normalized = decodeUrlEntities(value)
    .replace(/[\u0000-\u0020\u007f]/g, "")
    .toLowerCase()
  const m = /^([a-z][a-z0-9+.-]*):/.exec(normalized)
  if (!m) return false
  const scheme = m[1] ?? ""
  if (SAFE_URL_SCHEMES.has(scheme)) return false
  if (scheme === "data" && /^data:image\/(?:png|jpe?g|gif|webp|bmp);/.test(normalized)) return false
  return true
}

/**
 * 导出用 HTML 的净化。
 *
 * `markdownToHtml` 走的是 marked 默认配置 —— 它**允许原始 HTML 透传**。
 * 而对话内容来自用户输入与 LLM 输出，且 `downloadConversationAsPdf` 会把这段
 * HTML 通过 `innerHTML` 插进真实 DOM：一个 `<img src=x onerror=...>` 就会
 * 在导出 PDF 的瞬间执行。导出的 .html 文件被再次打开时同理。
 *
 * 这里是字符串级纵深防御，不做完整 HTML 解析（那需要 DOMParser，在本模块要
 * 求的纯函数环境下不可用）。目标是挡住已知的执行面，而不是做到完美：
 * 危险标签按黑名单剥离，URL 属性与事件属性按白名单/规范化后判定。
 */
export function sanitizeExportHtml(html: string): string {
  return html
    .replace(BLOCKED_PAIRED_TAG_RE, "")
    .replace(BLOCKED_STRAY_TAG_RE, "")
    .replace(URL_ATTR_RE, (whole: string, _lead: string, rawValue: string) => {
      const unquoted = rawValue.replace(/^["']/, "").replace(/["']$/, "")
      return isUnsafeUrl(unquoted) ? "" : whole
    })
    .replace(EVENT_ATTR_RE, "")
}

/** Build print-ready HTML for PDF export (messages only, no chrome). */
export function buildConversationPrintHtml(
  title: string,
  messages: ChatMessage[],
  meta?: ExportMetadata,
  lang: Lang = "zh"
): string {
  const filtered = filterExportableMessages(messages)
  const metaHtml = meta ? buildExportMetadataHtml(meta, lang) : ""
  const sections = filtered
    .map((m) => {
      const role = EXPORT_ROLE_LABEL[m.role]
      const body = sanitizeExportHtml(markdownToHtml(m.content.trim()))
      const sources =
        m.role === "assistant" && m.sources?.length
          ? `<ul class="sources">${m.sources
              .map((s) => {
                const label = escapeHtml(s.title)
                const href = safeHref(s.url)
                // 非 http(s) 链接只保留标题，不给可点击的 href
                return href ? `<li><a href="${escapeHtml(href)}">${label}</a></li>` : `<li>${label}</li>`
              })
              .join("")}</ul>`
          : ""
      return `<section class="msg msg-${m.role}"><h2>${escapeHtml(role)}</h2><div class="body">${body}</div>${sources}</section>`
    })
    .join("\n")

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; font-size: 11pt; line-height: 1.65; color: #111; margin: 0; padding: 0; }
  h1 { font-size: 18pt; text-align: center; margin: 0 0 0.5em; }
  .meta { text-align: center; font-size: 9pt; color: #666; margin-bottom: 1.5em; }
  h2 { font-size: 12pt; margin: 1.4em 0 0.35em; font-family: ui-monospace, monospace; letter-spacing: 0.02em; }
  .msg-user h2 { color: #1d4ed8; }
  .msg-assistant h2 { color: #047857; }
  .msg-system h2 { color: #6b7280; }
  .body p { margin: 0.4em 0; }
  .body pre { background: #f4f4f5; padding: 0.6em; overflow-x: auto; font-size: 9pt; border-radius: 4px; }
  .body table { border-collapse: collapse; width: 100%; margin: 0.6em 0; font-size: 10pt; }
  .body th, .body td { border: 1px solid #d4d4d8; padding: 0.35em 0.5em; }
  .body th { background: #f4f4f5; font-weight: 600; }
  .sources { margin: 0.5em 0 0; padding-left: 1.2em; font-size: 10pt; }
  .sources a { color: #2563eb; text-decoration: none; }
</style></head><body>
<h1>${escapeHtml(title.trim() || "对话")}</h1>
${metaHtml}
${sections}
</body></html>`
}

/** Render conversation messages to a downloadable A4 PDF via html2pdf.js. */
export async function downloadConversationAsPdf(
  filename: string,
  title: string,
  messages: ChatMessage[],
  meta?: ExportMetadata,
  lang: Lang = "zh"
) {
  if (typeof document === "undefined") return

  const host = document.createElement("div")
  host.className = "sk-pdf-export-host"
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:794px;max-width:794px;background:#fff;color:#111;padding:32px 40px;z-index:-1"
  host.innerHTML = buildConversationPrintHtml(title, messages, meta, lang)
  document.body.appendChild(host)

  try {
    const mod = await import("html2pdf.js")
    const html2pdf = mod.default
    await html2pdf()
      .set({
        margin: [12, 12, 12, 12],
        filename: filename.endsWith(".pdf") ? filename : `${filename.replace(/\.(md|docx?)$/i, "")}.pdf`,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .from(host)
      .save()
  } finally {
    host.remove()
  }
}
