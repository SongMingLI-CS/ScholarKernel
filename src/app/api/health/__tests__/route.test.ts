import { describe, expect, it } from "vitest"

import { GET } from "@/app/api/health/route"

describe("/api/health", () => {
  it("returns ok status", async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const json = (await res.json()) as { status: string; service: string }
    expect(json.status).toBe("ok")
    expect(json.service).toBe("scholarkernel-web")
  })
})
