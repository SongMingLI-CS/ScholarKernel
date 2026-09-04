import { NextResponse } from "next/server"
import path from "node:path"
import { existsSync, promises as fs } from "node:fs"
import { resolveUserIdFromRequest } from "@/lib/auth-user"
import { normalizeSafeProjectPath } from "@/lib/safe-project-path"

export const runtime = "nodejs"

export async function GET(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const rel = normalizeSafeProjectPath(url.searchParams.get("path") ?? "")
  if (!rel) {
    return NextResponse.json({ error: "InvalidPath" }, { status: 400 })
  }

  const root = process.cwd()
  const abs = path.join(/* turbopackIgnore: true */ root, rel)

  try {
    // Fast path: avoid throwing on missing files.
    if (!existsSync(abs)) {
      return NextResponse.json({ error: "NotFound" }, { status: 404 })
    }
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
    const msg = e instanceof Error ? e.message : "ReadFailed"
    const code = e && typeof e === "object" ? String((e as { code?: unknown }).code ?? "") : ""
    if (code === "ENOENT") return NextResponse.json({ error: "NotFound" }, { status: 404 })
    return NextResponse.json({ error: "ReadFailed", detail: msg }, { status: 404 })
  }
}
