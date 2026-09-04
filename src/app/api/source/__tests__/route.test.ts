import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth-user", () => ({
  resolveUserIdFromRequest: vi.fn(async () => "user-test"),
}))

import { resolveUserIdFromRequest } from "@/lib/auth-user"
import { GET } from "../route"

describe("GET /api/source", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveUserIdFromRequest).mockResolvedValue("user-test")
  })

  it("requires an authenticated user", async () => {
    vi.mocked(resolveUserIdFromRequest).mockResolvedValueOnce(null)

    const response = await GET(new Request("http://localhost/api/source?path=package.json"))

    expect(response.status).toBe(401)
  })

  it("rejects secret files even for authenticated users", async () => {
    const response = await GET(new Request("http://localhost/api/source?path=.env.local"))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "InvalidPath" })
  })
})
