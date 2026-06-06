import { jsonError, jsonOk } from "@/lib/api-utils"
import { parseLayoutAwareDocument } from "@/lib/document/layout-aware-parser"

export const runtime = "nodejs"

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const file = form.get("file")
    if (!(file instanceof Blob)) {
      return jsonError("MissingFile", 400)
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return jsonError("FileTooLarge", 413)
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
    })
  } catch (e) {
    console.error("[documents/parse]", e)
    const msg = e instanceof Error ? e.message : String(e)
    return jsonError(msg, 500)
  }
}
