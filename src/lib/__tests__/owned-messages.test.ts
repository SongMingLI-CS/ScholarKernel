import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ conversation: vi.fn(), find: vi.fn(), create: vi.fn(), update: vi.fn(), touch: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
  conversation: { findFirst: mocks.conversation, updateMany: mocks.touch },
  message: { findFirst: mocks.find, create: mocks.create, updateMany: mocks.update },
}) } }))
import { saveOwnedMessage } from "@/lib/owned-messages"

describe("normal conversation message persistence", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.conversation.mockResolvedValue({ id: "conv-1" }) })
  it("creates a message in the current conversation", async () => {
    mocks.find.mockResolvedValueOnce(null)
    mocks.create.mockResolvedValueOnce({ id: "m-1", content: "Question" })
    await expect(saveOwnedMessage("user-1", "conv-1", { id: "m-1", role: "user", content: "Question" })).resolves.toMatchObject({ id: "m-1" })
  })
  it("updates an existing message with the conversation and owner in the update condition", async () => {
    mocks.find.mockResolvedValue({ id: "m-1", content: "Updated" })
    mocks.update.mockResolvedValueOnce({ count: 1 })
    await saveOwnedMessage("user-1", "conv-1", { id: "m-1", role: "assistant", content: "Updated" })
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "m-1", conversationId: "conv-1", conversation: { userId: "user-1" } },
    }))
  })
})
