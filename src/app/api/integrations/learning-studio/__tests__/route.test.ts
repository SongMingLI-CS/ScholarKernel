import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "../route"

const { upsertUser, upsertConversation, transaction } = vi.hoisted(() => ({
  upsertUser: vi.fn(), upsertConversation: vi.fn(), transaction: vi.fn(),
}))
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }))
const payload = { requestId: "81520f50-8e6e-40a9-9a5b-e7cb84964914", title: "NumPy arrays", text: "An ndarray is a multidimensional array.", question: "Explain shape and dtype", sourceUrl: "https://studio.example/practice/one" }
const request = (body: unknown = payload, token = "test-bridge-token") => new Request("http://localhost/api/integrations/learning-studio", { method: "POST", headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("SCHOLAR_BRIDGE_TOKEN", "test-bridge-token")
  vi.stubEnv("AUTH_USER_ID", "reader")
  transaction.mockImplementation(async (fn) => fn({ user: { upsert: upsertUser }, conversation: { upsert: upsertConversation } }))
  upsertConversation.mockResolvedValue({ id: `learning-${payload.requestId}` })
})
afterEach(() => vi.unstubAllEnvs())
describe("Learning Studio import", () => {
  it("fails closed without configuration or with a wrong token", async () => {
    expect((await POST(request(payload, "wrong"))).status).toBe(401)
    vi.stubEnv("SCHOLAR_BRIDGE_TOKEN", "")
    expect((await POST(request())).status).toBe(503)
    expect(transaction).not.toHaveBeenCalled()
  })
  it("stores the source, original text and editable draft atomically under the configured owner", async () => {
    const response = await POST(request())
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ conversationId: `learning-${payload.requestId}` })
    const data = upsertConversation.mock.calls[0][0]
    expect(data.create.userId).toBe("reader")
    expect(data.create.documents.create.content).toContain(payload.text)
    expect(data.create.documents.create.content).toContain(payload.sourceUrl)
    expect(data.create.messages.create.metadata.learningStudioDraft).toContain(payload.question)
    expect(data.update).toEqual({})
    expect(data.where.id).toBe(`learning-${payload.requestId}`)
  })
  it.each([{ ...payload, text: "" }, { ...payload, text: "a".repeat(12001) }, { ...payload, question: "a".repeat(2001) }, { ...payload, sourceUrl: "javascript:alert(1)" }, { ...payload, requestId: "../other-user" }])("rejects invalid input before database access", async (body) => {
    expect((await POST(request(body))).status).toBe(400)
    expect(transaction).not.toHaveBeenCalled()
  })
  it("reports storage failure without exposing the upstream error", async () => {
    transaction.mockRejectedValueOnce(new Error("database secret"))
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain("database secret")
  })
})
