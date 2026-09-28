import { describe, expect, it } from "vitest"
import { withAppPath } from "../app-path"
describe("deployment path", () => {
  it("keeps root deployment and external URLs unchanged", () => {
    expect(withAppPath("/api/settings", "")).toBe("/api/settings")
    expect(withAppPath("https://api.deepseek.com/v1", "/scholar")).toBe("https://api.deepseek.com/v1")
  })
  it("prefixes local paths once including query strings", () => {
    expect(withAppPath("/api/settings?x=1", "/scholar")).toBe("/scholar/api/settings?x=1")
    expect(withAppPath("/scholar/api/settings", "/scholar")).toBe("/scholar/api/settings")
    expect(withAppPath("/", "/scholar")).toBe("/scholar/")
  })
})
