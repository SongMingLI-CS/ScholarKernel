import { NextResponse } from "next/server"
import path from "node:path"
import { existsSync, promises as fs } from "node:fs"

export const runtime = "nodejs"

function isSafeRelative(p: string) {
  if (!p || p.includes("\0")) return false
  if (path.isAbsolute(p)) return false
  const norm = p.replace(/\\/g, "/")
  if (norm.startsWith("../") || norm.includes("/../")) return false
  if (norm.startsWith("node_modules/") || norm.includes("/node_modules/")) return false
  return true
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const rel = url.searchParams.get("path") ?? ""
  if (!isSafeRelative(rel)) {
    return NextResponse.json({ error: "InvalidPath" }, { status: 400 })
  }

  const root = process.cwd()
  const abs = path.join(root, rel)

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

