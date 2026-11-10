import { expect, test } from "@playwright/test";

/**
 * Чат widget-ът в браузъра. Пропуска се, ако чатът не е настроен (n8n/OpenAI).
 * С мока (SMOKE_MOCK=1) проверява и съдържанието на отговора.
 */
test("чат: отваряне, съобщение, стриймнат отговор, нов разговор", async ({ page, request }) => {
  const probe = await request.post("/api/chat", {
    headers: { origin: process.env.E2E_BASE_URL ?? "http://localhost:3000" },
    data: { message: "здравей" },
  });
  test.skip(probe.status() === 503, "Чатът не е настроен (n8n/OpenAI)");

  await page.goto("/");
  await page.getByRole("button", { name: "Отвори чат за записване" }).click();
  const dialog = page.getByRole("dialog", { name: "Асистент за записване" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Вашето съобщение")).toBeFocused();

  await dialog.getByLabel("Вашето съобщение").fill("Какви услуги имате?");
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("Какви услуги имате?")).toBeVisible();

  const log = dialog.getByRole("log");
  if (process.env.SMOKE_MOCK === "1") {
    await expect(log).toContainText(/Предлагаме \d+ услуги/, { timeout: 30_000 });
  } else {
    await expect(log.locator("p").nth(2)).toBeVisible({ timeout: 60_000 });
  }

  // Разговорът се пази при навигация (sessionStorage).
  await page.goto("/privacy");
  await page.getByRole("button", { name: "Отвори чат за записване" }).click();
  await expect(page.getByRole("dialog").getByText("Какви услуги имате?")).toBeVisible();

  await page.getByRole("button", { name: "Нов разговор" }).click();
  await expect(page.getByRole("dialog").getByText("Какви услуги имате?")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Отвори чат за записване" })).toBeFocused();
});
