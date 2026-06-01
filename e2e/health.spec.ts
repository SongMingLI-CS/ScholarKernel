import { test, expect } from "@playwright/test"

test("health endpoint returns ok", async ({ request }) => {
  const res = await request.get("/api/health")
  expect(res.ok()).toBeTruthy()
  const json = (await res.json()) as { status: string }
  expect(json.status).toBe("ok")
})
