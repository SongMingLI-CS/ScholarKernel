import { expect, test } from "@playwright/test"

test("chat composer accepts a research task draft", async ({ page }) => {
  await page.goto("/")

  const skipOnboarding = page.getByRole("button", { name: "跳过向导" })
  if (await skipOnboarding.isVisible().catch(() => false)) {
    await skipOnboarding.click()
  }

  const composer = page.getByPlaceholder(/输入任务|Type a task/)
  await expect(composer).toBeVisible()
  await composer.fill("用三句话解释 Transformer 的自注意力机制")
  await expect(composer).toHaveValue("用三句话解释 Transformer 的自注意力机制")
  await expect(page.getByRole("button", { name: "send" })).toBeEnabled()
})
