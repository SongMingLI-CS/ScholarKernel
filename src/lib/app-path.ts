/** Keep browser requests inside the optional Next.js deployment prefix. */
export function withAppPath(path: string, basePath: string): string {
  const base = basePath.replace(/\/$/, "")
  if (!base || !path.startsWith("/") || path.startsWith("//") || path === base || path.startsWith(`${base}/`)) return path
  return `${base}${path}`
}
export const appPath = (path: string) => withAppPath(path, process.env.NEXT_PUBLIC_BASE_PATH || "")
