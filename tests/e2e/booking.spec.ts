import { expect, test } from "@playwright/test";

/**
 * Основният път на клиента: начална страница → избор → резервация → таен линк → отмяна.
 * Изисква работещ стек с демо данни (`npm run db:seed`).
 */
test("избор → резервация → страница с таен линк → отмяна", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // JSON-LD за търсачките
  const ld = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}",
  );
  expect(ld["@type"]).toBe("HairSalon");

  await page.getByRole("link", { name: "Запази час" }).first().click();
  await expect(page).toHaveURL(/\/book$/);

  // 1. Услуга
  await page.getByRole("button", { name: /Мъжко подстригване/ }).click();
  // 2. Бръснар
  await expect(page.getByRole("heading", { name: "Изберете бръснар" })).toBeFocused();
  await page.getByRole("button", { name: /Георги Петров/ }).click();
  // 3. Дата: първата активна дата в календара
  await expect(page.getByRole("heading", { name: "Изберете дата" })).toBeVisible();
  const day = page
    .getByRole("group", { name: /Дати в/ })
    .locator("button:not([disabled])")
    .first();
  await day.click();
  // 4. Час: последният свободен (най-далече от минималното време напред)
  await expect(page.getByRole("heading", { name: "Изберете час" })).toBeVisible();
  await page
    .getByRole("button", { name: /^\d{2}:\d{2}$/ })
    .last()
    .click();

  // 5. Данни — първо невалидни, за да видим клиентската валидация
  await page.getByLabel("Име", { exact: true }).fill("Иван Тестов");
  await page.getByLabel("Телефон", { exact: true }).fill("123");
  await page.getByRole("button", { name: "Напред" }).click();
  await expect(page.getByText(/Невалиден телефонен номер/)).toBeVisible();
  await expect(page.getByText(/Необходимо е съгласие/)).toBeVisible();

  const phone = `0899 ${String(Date.now()).slice(-6)}`;
  await page.getByLabel("Телефон", { exact: true }).fill(phone);
  await page.getByRole("checkbox", { name: /Съгласен съм/ }).check();
  await page.getByRole("button", { name: "Напред" }).click();

  // 6. Потвърждение
  await expect(page.getByRole("heading", { name: "Потвърдете записването" })).toBeVisible();
  await expect(page.getByText("Георги Петров")).toBeVisible();
  await page.getByRole("button", { name: "Потвърди записването" }).click();

  // Страница на резервацията с тайния линк
  await expect(page).toHaveURL(/\/booking\/[A-Za-z0-9_-]{43}\?new=1$/);
  await expect(page.getByText("Записахте час!")).toBeVisible();
  const link = await page.getByLabel("Линк за управление на резервацията").inputValue();
  expect(link).toMatch(/\/booking\/[A-Za-z0-9_-]{43}$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  // Отваряне на линка наново и отмяна
  await page.goto(new URL(link).pathname);
  await expect(page.getByText("Потвърдена")).toBeVisible();
  await page.getByRole("button", { name: "Отмени часа" }).click();
  await page.getByRole("button", { name: "Да, отмени" }).click();
  await expect(page.getByText("Часът е отменен.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Отменена")).toBeVisible();
  await expect(page.getByRole("button", { name: "Отмени часа" })).toHaveCount(0);
});

test("невалиден таен линк → 404 с обяснение", async ({ page }) => {
  const res = await page.goto("/booking/" + "a".repeat(43));
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Резервацията не е намерена" })).toBeVisible();
});

test("предварително избрана услуга от ценоразписа", async ({ page }) => {
  await page.goto("/#uslugi");
  await page.getByRole("link", { name: "Запази час за Fade" }).click();
  await expect(page.getByRole("heading", { name: "Изберете бръснар" })).toBeVisible();
  await expect(page.getByText("За „Fade“")).toBeVisible();
});
