import { NextResponse } from "next/server"
import { promises as fs } from "node:fs"

import { resolveUserIdFromRequest } from "@/lib/auth-user"
import { isAuthEnabled } from "@/lib/session-auth"
import { resolveSourceFilePath } from "@/lib/source-route-guard"

export const runtime = "nodejs"

export async function GET(req: Request) {
  // 该路由不在 middleware 的保护列表里（只覆盖 conversations / agent / canvas），
  // 因此必须在路由内自行校验身份；否则任何能访问端口的人都能读源码与配置文件。
  if (isAuthEnabled()) {
    const userId = await resolveUserIdFromRequest(req)
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  const rel = url.searchParams.get("path") ?? ""

  const abs = resolveSourceFilePath(process.cwd(), rel)
  if (!abs) {
    return NextResponse.json({ error: "InvalidPath" }, { status: 400 })
  }

  try {
    const st = await fs.stat(abs)
    if (!st.isFile()) return NextResponse.json({ error: "NotAFile" }, { status: 400 })
    const text = await fs.readFile(abs, "utf8")
    return new NextResponse(text, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    })
  } catch (e) {
    console.error("[GET /api/source]", e)
    const code = e && typeof e === "object" ? String((e as { code?: unknown }).code ?? "") : ""
    if (code === "ENOENT") return NextResponse.json({ error: "NotFound" }, { status: 404 })
    // 不回显内部异常文本（可能含绝对路径）
    return NextResponse.json({ error: "ReadFailed" }, { status: 500 })
  }
}
