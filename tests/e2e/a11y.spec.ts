import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Достъпност (axe-core, WCAG 2.1 A/AA) и Content-Security-Policy на основните страници.
 * CSP: страницата трябва да е хидратирана (JS работи с nonce) и без нарушения в конзолата.
 */
const PAGES = [
  { path: "/", name: "начало" },
  { path: "/book", name: "записване" },
  { path: "/privacy", name: "поверителност" },
  { path: "/admin/login", name: "вход в админа" },
  { path: "/nqma-takava-stranica", name: "404" },
];

function collectCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (/Content Security Policy|Content-Security-Policy/i.test(msg.text())) {
      violations.push(msg.text());
    }
  });
  return violations;
}

for (const { path, name } of PAGES) {
  test(`a11y + CSP: ${name} (${path})`, async ({ page }) => {
    const csp = collectCspViolations(page);
    const res = await page.goto(path);
    expect(res!.status()).toBe(path.startsWith("/nqma") ? 404 : 200);
    expect(res!.headers()["content-security-policy"]).toMatch(/script-src 'self' 'nonce-/);
    await page.waitForLoadState("networkidle");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const summary = results.violations.map(
      (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
    expect(summary, summary.join("\n")).toEqual([]);
    expect(csp, csp.join("\n")).toEqual([]);
  });
}

test("CSP: картата се зарежда след клик (frame-src openstreetmap)", async ({ page }) => {
  const csp = collectCspViolations(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Покажи картата" }).click();
  await expect(page.locator('iframe[src^="https://www.openstreetmap.org/"]')).toBeVisible();
  expect(csp).toEqual([]);
});

test("чат widget-ът се отваря (хидратация под CSP) и е достъпен", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /чат|помощ|въпрос/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test("SEO: robots.txt, sitemap.xml, OG изображение", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /booking/");
  expect(robots).toMatch(/Sitemap: https?:\/\/.+\/sitemap\.xml/);
  const sitemap = await request.get("/sitemap.xml");
  expect(await sitemap.text()).toContain("/book</loc>");
  const og = await request.get("/opengraph-image");
  expect(og.headers()["content-type"]).toBe("image/png");
});
