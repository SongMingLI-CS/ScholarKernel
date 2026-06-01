/**
 * Next.js instrumentation entrypoint.
 *
 * Next will look for `src/instrumentation.ts` automatically.
 * We keep node-only logic inside `instrumentation.node.ts` to avoid bundling `fs` into edge/runtime.
 */
export async function register() {
  // Next sets NEXT_RUNTIME to "nodejs" or "edge".
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const mod = await import("./instrumentation.node")
    mod.register()
  }
}

