import { describe, expect, it, vi } from "vitest"
import { createFileTool } from "../file-tool"

describe("file tool runtime boundary", () => {
  it("does not attempt a filesystem read without an injected server reader", async () => {
    const execute = createFileTool().execute!
    const result = await execute({ path: "package.json", maxChars: 100 }, { toolCallId: "test", messages: [] })
    expect(result).toMatchObject({ ok: false, error: "BrowserNoFs" })
  })
  it("uses the injected server reader and respects the output limit", async () => {
    const read = vi.fn().mockResolvedValue({ ok: true, path: "test.txt", text: "abcdef" })
    const execute = createFileTool(read).execute!
    const result = await execute({ path: "test.txt", maxChars: 3 }, { toolCallId: "test", messages: [] })
    expect(read).toHaveBeenCalledWith("test.txt")
    expect(result).toMatchObject({ ok: true, chars: 6, text: "abc\n\n[...truncated...]" })
  })
})
