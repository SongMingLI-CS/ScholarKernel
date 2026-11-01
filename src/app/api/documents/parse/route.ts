import { jsonError, jsonOk } from "@/lib/api-utils"
import { parseLayoutAwareDocument } from "@/lib/document/layout-aware-parser"

export const runtime = "nodejs"

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

export async function POST(req: Request) {
  try {
    // 先看声明体积再解析：req.formData() 会把整个 body 读进内存，
    // 放在它之后比对 file.size 无法阻止超大请求占用内存。
    const declared = Number(req.headers.get("content-length") ?? "")
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
      return jsonError("FileTooLarge", 413)
    }

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
      chunks: parsed.chunks,
      ragContext: parsed.ragContext,
    })
  } catch (e) {
    // 不把内部异常文本回显给客户端（可能包含绝对路径/解析器细节），详细内容只进日志
    console.error("[documents/parse]", e)
    return jsonError("ParseFailed", 500)
  }
}
