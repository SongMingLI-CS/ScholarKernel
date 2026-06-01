import { describe, expect, it } from "vitest"
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"

describe("api-utils", () => {
  it("jsonOk wraps data with 200", async () => {
    const res = jsonOk({ ok: true })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it("jsonError returns message and status", async () => {
    const res = jsonError("bad", 400)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: "bad" })
  })

  it("parseJsonBody returns null on invalid json", async () => {
    const req = new Request("http://localhost", {
      method: "POST",
      body: "not-json",
    })
    await expect(parseJsonBody(req)).resolves.toBeNull()
  })
})
