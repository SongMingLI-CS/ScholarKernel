import type { FileReader } from "./file-tool"
export { createOwnedDocumentReader } from "@/lib/document-service"

/** @deprecated User material must be read through an owner-bound document reader. */
export const safeReadTextFile: FileReader = async (documentId) => ({
  ok: false,
  path: documentId,
  error: "DocumentAccessRequired",
  hint: "请使用当前用户已保存的文档 ID；不支持读取本机路径。",
})
