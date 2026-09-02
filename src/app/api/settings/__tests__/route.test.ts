import { beforeEach, describe, expect, it, vi } from "vitest"

import { GET, PATCH } from "../route"

const { upsert, update } = vi.hoisted(() => ({
  upsert: vi.fn(),
  update: vi.fn(),
}))

vi.mock("@/lib/auth-user", () => ({
  resolveUserIdFromRequest: vi.fn(async () => "user-test"),
}))

vi.mock("@/lib/crypto-server", () => ({
  encryptForStorage: (plain: string) => `enc:${plain}`,
  decryptFromStorage: (stored: string) => stored.replace(/^enc:/, ""),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userSetting: {
      upsert,
      update,
    },
  },
}))

import { resolveUserIdFromRequest } from "@/lib/auth-user"

describe("/api/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveUserIdFromRequest).mockResolvedValue("user-test")
    upsert.mockResolvedValue({
      userId: "user-test",
      theme: "dark",
      runtimeKeys: null,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    })
  })

  it("GET returns 401 when unauthenticated", async () => {
    vi.mocked(resolveUserIdFromRequest).mockResolvedValueOnce(null)
    const res = await GET(new Request("http://localhost/api/settings"))
    expect(res.status).toBe(401)
  })

  it("GET returns settings payload", async () => {
    upsert.mockResolvedValueOnce({
      userId: "user-test",
      theme: "dark",
      runtimeKeys: 'enc:{"openai":"server-secret","deepseek":""}',
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    })
    const res = await GET(new Request("http://localhost/api/settings"))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { userId: string; theme: string }
    expect(json.userId).toBe("user-test")
    expect(json.theme).toBe("dark")
    expect(json).not.toHaveProperty("runtimeKeys")
    expect(JSON.stringify(json)).not.toContain("server-secret")
    expect(json).toMatchObject({ runtimeKeyStatus: { openai: true, deepseek: false } })
  })

  it("PATCH returns 400 on invalid body", async () => {
    const req = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    })
    const res = await PATCH(req)
    expect(res.status).toBe(400)
  })

  it("PATCH updates theme", async () => {
    update.mockResolvedValueOnce({
      userId: "user-test",
      theme: "light",
      runtimeKeys: null,
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    })
    const req = new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: "light" }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { theme: string }
    expect(json.theme).toBe("light")
  })

  it("PATCH stores keys but never returns plaintext", async () => {
    update.mockResolvedValueOnce({
      userId: "user-test",
      theme: "dark",
      runtimeKeys: 'enc:{"openai":"new-secret"}',
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    })
    const res = await PATCH(new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runtimeKeys: { openai: "new-secret" } }),
    }))
    const raw = await res.text()
    expect(raw).not.toContain("new-secret")
    expect(JSON.parse(raw)).toMatchObject({ runtimeKeyStatus: { openai: true } })
  })
})
