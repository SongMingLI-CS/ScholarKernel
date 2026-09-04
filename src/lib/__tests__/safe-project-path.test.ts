import { describe, expect, it } from "vitest"

import { normalizeSafeProjectPath } from "@/lib/safe-project-path"

describe("normalizeSafeProjectPath", () => {
  it("allows explicit source and documentation locations", () => {
    expect(normalizeSafeProjectPath("src/app/page.tsx")).toBe("src/app/page.tsx")
    expect(normalizeSafeProjectPath("./docs/deployment.md")).toBe("docs/deployment.md")
    expect(normalizeSafeProjectPath("package.json")).toBe("package.json")
  })

  it("rejects traversal, absolute, secret, generated and dependency paths", () => {
    for (const unsafe of [
      "../.env.local",
      "src/../../.env.local",
      "/etc/passwd",
      ".env.local",
      ".git/config",
      "node_modules/pkg/index.js",
      "generated/prisma/client.ts",
      "src/.secret/key",
    ]) {
      expect(normalizeSafeProjectPath(unsafe)).toBeNull()
    }
  })
})
