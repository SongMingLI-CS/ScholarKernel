import {
  AlignmentType,
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
import { markdownToHtml } from "@/lib/markdown-bridge"
import type { ChatMessage } from "@/store/useAgentStore"

type InlinePart = { text: string; bold?: boolean; italic?: boolean }

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

function inlineParagraph(text: string, opts?: { heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel] }) {
  const runs = parseInline(text).map(
    (p) =>
      new TextRun({
        text: p.text,
        bold: p.bold,
        italics: p.italic,
      })
  )
  return new Paragraph({
    heading: opts?.heading,
    children: runs.length ? runs : [new TextRun("")],
    spacing: { after: 120 },
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
export async function exportMarkdownAsDocx(title: string, markdown: string): Promise<Blob> {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
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

    if (isTableRow(trimmed)) {
      const tableRows: string[][] = []
      while (i < lines.length && isTableRow(lines[i] ?? "")) {
        if (!isTableSeparator(lines[i] ?? "")) tableRows.push(parseTableRow(lines[i] ?? ""))
        i += 1
      }
      if (tableRows.length) children.push(tableFromRows(tableRows))
      continue
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `• ${trimmed.replace(/^[-*+]\s+/, "")}` })],
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
export async function downloadMarkdownAsDocx(filename: string, title: string, markdown: string) {
  const blob = await exportMarkdownAsDocx(title, markdown)
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
export async function exportConversationAsDocx(title: string, messages: ChatMessage[]): Promise<Blob> {
  const filtered = filterExportableMessages(messages)
  const md = formatConversationAsMarkdown(title, filtered)
  return exportMarkdownAsDocx(title, md)
}

export async function downloadConversationAsDocx(filename: string, title: string, messages: ChatMessage[]) {
  const blob = await exportConversationAsDocx(title, messages)
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

/** Build print-ready HTML for PDF export (messages only, no chrome). */
export function buildConversationPrintHtml(title: string, messages: ChatMessage[]): string {
  const filtered = filterExportableMessages(messages)
  const exportedAt = new Date().toISOString()
  const sections = filtered
    .map((m) => {
      const role = EXPORT_ROLE_LABEL[m.role]
      const body = markdownToHtml(m.content.trim())
      const sources =
        m.role === "assistant" && m.sources?.length
          ? `<ul class="sources">${m.sources
              .map((s) => `<li><a href="${escapeHtml(s.url)}">${escapeHtml(s.title)}</a></li>`)
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
<p class="meta">Exported ${escapeHtml(exportedAt)}</p>
${sections}
</body></html>`
}

/** Render conversation messages to a downloadable A4 PDF via html2pdf.js. */
export async function downloadConversationAsPdf(filename: string, title: string, messages: ChatMessage[]) {
  if (typeof document === "undefined") return

  const host = document.createElement("div")
  host.className = "sk-pdf-export-host"
  host.style.cssText =
    "position:fixed;left:-10000px;top:0;width:794px;max-width:794px;background:#fff;color:#111;padding:32px 40px;z-index:-1"
  host.innerHTML = buildConversationPrintHtml(title, messages)
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
