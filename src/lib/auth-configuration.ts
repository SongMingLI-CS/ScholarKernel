/** Shared by server and middleware; public production never falls back to a shared user. */
export function authenticationRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" || Boolean(env.AUTH_PASSWORD?.trim()) || Boolean(env.GITHUB_ID?.trim() && env.GITHUB_SECRET?.trim())
}
