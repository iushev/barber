import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Админ панел срещу работещ стек с демо данни (`npm run db:seed`).
 * Изисква ADMIN_EMAIL/ADMIN_PASSWORD в .env (администраторът се създава при старт).
 */
const EMAIL = process.env.ADMIN_EMAIL ?? "";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "";

// 1×1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

async function login(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Имейл").fill(EMAIL);
  await page.getByLabel("Парола").fill(PASSWORD);
  await page.getByRole("button", { name: "Вход" }).click();
  await expect(page).toHaveURL(/\/admin\/bookings$/);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  test.skip(!EMAIL || !PASSWORD, "Няма ADMIN_EMAIL/ADMIN_PASSWORD");
});

test("защитените страници пренасочват към входа; грешна парола показва грешка", async ({
  page,
}) => {
  await page.goto("/admin/bookings");
  await expect(page).toHaveURL(/\/admin\/login$/);

  await page.getByLabel("Имейл").fill(EMAIL);
  await page.getByLabel("Парола").fill("wrong-password");
  await page.getByRole("button", { name: "Вход" }).click();
  await expect(page.getByText("Невалиден имейл или парола.")).toBeVisible();

  // Фалшиво cookie минава proxy-то, но сървърната проверка пренасочва.
  await page
    .context()
    .addCookies([{ name: "barber_admin", value: "x".repeat(43), url: "http://localhost:3000" }]);
  await page.goto("/admin/barbers");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("бръснар: снимка и седмичен график", async ({ page }) => {
  await login(page);
  await page
    .getByRole("navigation", { name: "Админ навигация" })
    .getByRole("link", { name: "Бръснари" })
    .click();
  await page.getByRole("link", { name: "Георги Петров" }).click();

  await page
    .getByLabel("Файл със снимка")
    .setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Качи" }).click();
  await expect(page.getByRole("status")).toContainText("Снимката е качена");
  const img = page.getByRole("img", { name: "Снимка на Георги Петров" });
  await expect(img).toBeVisible();
  const src = await img.getAttribute("src");
  const res = await page.request.get(src!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");

  await page.getByRole("button", { name: "Запази графика" }).click();
  await expect(page.getByText("Графикът е запазен.")).toBeVisible();
});

test("ръчна резервация → смяна на статус → анонимизиране", async ({ page }) => {
  await login(page);
  await page.goto("/admin/bookings/new");
  await page.getByLabel("Услуга").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Покажи" }).click();
  await page.getByLabel("Бръснар").selectOption({ index: 1 });
  // Дата: след 5 дни (почти сигурно има работен ден в демо графика в рамките на седмица).
  for (let add = 1; add <= 7; add++) {
    const d = new Date(Date.now() + add * 86_400_000);
    const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(d);
    await page.getByLabel("Дата").fill(iso);
    await page.getByRole("button", { name: "Покажи" }).click();
    if (await page.getByText("2. Клиент и час").isVisible()) {
      if (!(await page.getByText("Няма свободни часове за тази дата.").isVisible())) break;
    }
  }
  await page.getByLabel("Име").fill("Тестов Клиент");
  await page.getByLabel("Телефон").fill("0899 555 0" + String(Date.now()).slice(-2));
  await page
    .getByRole("button", { name: /^\d{2}:\d{2}$/ })
    .last()
    .click();
  await expect(page).toHaveURL(/\/admin\/bookings\/[0-9a-f-]{36}\?created=1$/);
  await expect(page.getByText("Резервацията е създадена.")).toBeVisible();

  await page.getByLabel("Нов статус").selectOption("completed");
  await page.getByRole("button", { name: "Запази статуса" }).click();
  await expect(page.getByText("Статусът е променен.")).toBeVisible();

  await page.getByLabel("Разбирам, че действието е необратимо.").check();
  await page.getByRole("button", { name: "Анонимизирай" }).click();
  await expect(page.getByText(/Анонимизирани резервации: 1\./)).toBeVisible();
  await page.reload();
  await expect(page.getByText("Анонимизиран клиент").first()).toBeVisible();
});

test("изход прекратява сесията", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "Изход" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.goto("/admin/bookings");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("достъпност на админ страниците (axe, WCAG 2.1 AA)", async ({ page }) => {
  await login(page);
  for (const path of [
    "/admin/bookings",
    "/admin/bookings/new",
    "/admin/barbers",
    "/admin/services",
    "/admin/account",
  ]) {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const summary = results.violations.map(
      (v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
    expect(summary, summary.join("\n")).toEqual([]);
  }
});
