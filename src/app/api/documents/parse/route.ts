import { logDiagnosticError } from "@/lib/diagnostics"
import { jsonError, jsonOk } from "@/lib/api-utils"
import { parseLayoutAwareDocument } from "@/lib/document/layout-aware-parser"
import { MAX_PDF_BYTES, PdfParseError } from "@/lib/document/pdf-text-extract"

export const runtime = "nodejs"

const MAX_UPLOAD_BYTES = MAX_PDF_BYTES
const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024

export async function POST(req: Request) {
  try {
    const contentLength = Number(req.headers.get("content-length"))
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
    ) {
      return jsonError("文件超过 8 MiB 限制，请压缩或拆分后重试。", 413)
    }

    const form = await req.formData()
    const file = form.get("file")
    if (!(file instanceof Blob)) {
      return jsonError("MissingFile", 400)
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return jsonError("文件超过 8 MiB 限制，请压缩或拆分后重试。", 413)
    }

    const filename =
      file instanceof File && file.name.trim()
        ? file.name.trim()
        : typeof form.get("filename") === "string"
          ? String(form.get("filename"))
          : "upload.bin"

    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = await parseLayoutAwareDocument({
      buffer,
      filename,
      mimeType: file.type || undefined,
    })

    return jsonOk({
      text: parsed.text,
      format: parsed.format,
      layout: parsed.layout,
      parser: parsed.parser,
      blocks: parsed.blocks,
      warnings: parsed.warnings,
      chunks: parsed.chunks,
      ragContext: parsed.ragContext,
    })
  } catch (e) {
    if (e instanceof PdfParseError) return jsonError(e.message, e.status)

    logDiagnosticError("[documents/parse]", e)
    const msg = e instanceof Error ? e.message : String(e)
    return jsonError(msg, 500)
  }
}
