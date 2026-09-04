const ALLOWED_ROOT_FILES = new Set([
  "AGENTS.md",
  "README.md",
  "eslint.config.mjs",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "playwright.config.ts",
  "prisma.config.ts",
  "tsconfig.json",
  "vitest.config.ts",
])

const ALLOWED_ROOT_DIRS = new Set([
  "docs",
  "e2e",
  "logs",
  "papers",
  "prisma",
  "scripts",
  "src",
  "test",
  "tests",
])

/** Restrict server-side source reads to reviewed project locations and never expose secrets. */
export function normalizeSafeProjectPath(input: string): string | null {
  const raw = input.trim()
  if (!raw || raw.includes("\0") || raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw)) return null

  const normalized = raw.replace(/\\/g, "/").replace(/^\.\//, "")
  const segments = normalized.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
    return null
  }

  if (segments.length === 1) return ALLOWED_ROOT_FILES.has(normalized) ? normalized : null
  if (!ALLOWED_ROOT_DIRS.has(segments[0]!)) return null
  if (segments[0] === "prisma" && normalized !== "prisma/schema.prisma" && !normalized.startsWith("prisma/migrations/")) {
    return null
  }
  return normalized
}
