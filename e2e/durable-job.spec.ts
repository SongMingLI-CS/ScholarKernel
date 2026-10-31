import { expect, test } from "@playwright/test"

test.skip(process.env.NEXT_PUBLIC_AGENT_EXECUTION !== "server", "Opt-in server Job browser integration")
test("normal chat and page refresh observe one durable Job", async ({ page }) => {
  let creations = 0
  let observations = 0
  let assistantMessageId = "browser-answer"
  const result = { final: "持久化任务的合成回归回答", nodes: [], sources: [], status: "done" }
  await page.route("**/api/agent/jobs?*", route => route.fulfill({ json: creations ? [{ id: "browser-fixture", status: "running", assistantMessageId, eventSequence: 1 }] : [] }))
  await page.route("**/api/agent/jobs", async route => {
    if (route.request().method() !== "POST") return route.continue()
    creations++
    const jobInput = route.request().postDataJSON() as { assistantMessageId?: unknown }
    expect(typeof jobInput.assistantMessageId).toBe("string")
    assistantMessageId = jobInput.assistantMessageId as string
    await route.fulfill({ status: 202, json: { id: "browser-fixture", status: "pending" } })
  })
  await page.route("**/api/agent/jobs/browser-fixture", route => route.fulfill({ json: { id: "browser-fixture", status: observations > 1 ? "completed" : "running", result } }))
  await page.route("**/api/agent/jobs/browser-fixture/events?*", async route => {
    observations++
    const event = observations === 1
      ? { sequence: 1, type: "output_delta", payload: { text: "刷新前任务运行中" } }
      : { sequence: 2, type: "job_completed", payload: result }
    await route.fulfill({ contentType: "text/event-stream", body: `retry: 10000\nid: browser-fixture:${event.sequence}\ndata: ${JSON.stringify(event)}\n\n` })
  })
  await page.addInitScript(() => localStorage.setItem("sk:onboarding:v1", "done"))
  await page.goto("/")
  const conversationResponse = page.waitForResponse(response => {
    const url = new URL(response.url())
    return response.request().method() === "POST" && url.pathname === "/api/conversations"
  })
  await page.getByRole("button", { name: "新建对话" }).click()
  const response = await conversationResponse
  expect(response.ok()).toBeTruthy()
  const createdConversation = (await response.json()) as { id?: string }
  expect(createdConversation.id).toBeTruthy()
  await expect(page).toHaveURL(/[?&]c=[^&]+/)
  const conversationId = new URL(page.url()).searchParams.get("c")
  expect(conversationId).toBe(createdConversation.id)
  const composer = page.getByPlaceholder(/输入任务|Type a task/)
  await expect(composer).toBeVisible()
  await expect(composer).toHaveValue("")
  await composer.fill("你好")
  const sendButton = page.getByRole("button", { name: "send" })
  await expect(sendButton).toBeEnabled()
  await sendButton.click()
  await expect(page.getByText("刷新前任务运行中", { exact: true })).toBeVisible()
  await page.reload()
  await expect.poll(() => observations, { timeout: 20000 }).toBeGreaterThanOrEqual(2)
  await expect(page.getByText(result.final, { exact: true })).toBeVisible({ timeout: 20000 })
  expect(creations).toBe(1)
  expect(observations).toBeGreaterThanOrEqual(2)
})
