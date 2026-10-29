import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "@/app/api/documents/parse/route"
import { setExternalLayoutParser } from "@/lib/document/layout-aware-parser"

describe("POST /api/documents/parse", () => {
  beforeEach(() => {
    vi.stubEnv("LAYOUT_PARSER_URL", "")
    vi.stubEnv("LAYOUT_PARSER_API_KEY", "")
    setExternalLayoutParser(null)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    setExternalLayoutParser(null)
  })

  it("parses a normal academic text upload into chunks", async () => {
    const form = new FormData()
    form.append(
      "file",
      new Blob(["1. Introduction\n\nThis paper studies retrieval augmented generation."], {
        type: "text/plain",
      }),
      "paper.txt"
    )

    const response = await POST(
      new Request("http://localhost/api/documents/parse", { method: "POST", body: form })
    )
    const result = (await response.json()) as {
      format: string
      parser: string
      text: string
      chunks: Array<{ text: string }>
    }

    expect(response.status).toBe(200)
    expect(result.format).toBe("text")
    expect(result.parser).toBe("local")
    expect(result.text).toContain("retrieval augmented generation")
    expect(result.chunks.length).toBeGreaterThan(0)
  })
})
