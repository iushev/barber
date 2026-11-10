/**
 * Smoke тест на /api/chat срещу работещ compose стек (app → n8n → OpenAI или мок).
 *
 *   docker compose --profile mock up -d mock-openai
 *   OPENAI_API_KEY=mock OPENAI_BASE_URL=http://mock-openai:8080/v1 ./scripts/n8n/setup.sh
 *   SMOKE_MOCK=1 npm run test:smoke
 *
 * Пропуска се, ако стекът не работи или чатът не е настроен (503 chat_unavailable).
 * SMOKE_MOCK=1 включва и пълния сценарий за записване (детерминиран само с мока).
 */
import { describe, expect, it } from "vitest";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

async function stackUp(): Promise<boolean> {
  try {
    return (await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

async function chat(message: string, cookie?: string) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { origin: BASE, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(120_000),
  });
  const setCookie = res.headers.get("set-cookie")?.split(";")[0];
  const raw = await res.text();
  const events = res.headers.get("content-type")?.includes("ndjson")
    ? raw
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { type: string; text?: string })
    : [];
  const text = events
    .filter((e) => e.type === "delta")
    .map((e) => e.text)
    .join("");
  return { status: res.status, raw, events, text, cookie: setCookie ?? cookie };
}

describe("smoke: /api/chat ↔ n8n", () => {
  it("агентът отговаря през стрийм и ползва инструментите", async (ctx) => {
    if (!(await stackUp())) ctx.skip();
    const first = await chat("Какви услуги имате?");
    if (first.status === 503) ctx.skip(); // n8n/OpenAI не са настроени
    expect(first.status).toBe(200);
    expect(first.events.at(-1)?.type).toBe("done");
    expect(first.text.length).toBeGreaterThan(0);
    if (process.env.SMOKE_MOCK === "1") {
      // Мокът вика list_services → отговорът съдържа реалния брой услуги от БД.
      expect(first.text).toMatch(/Предлагаме \d+ услуги/);
    }
  });

  it("пълно записване през агента (само с мок)", async (ctx) => {
    if (process.env.SMOKE_MOCK !== "1" || !(await stackUp())) ctx.skip();
    const phone = `0888 ${String(Date.now()).slice(-6)}`;
    const booking = await chat(`Запиши ме, телефон ${phone}`);
    expect(booking.status).toBe(200);
    expect(booking.text).toMatch(
      /Готово! Записах ви за .+ Запазете линка: https?:\/\/\S+\/booking\/[A-Za-z0-9_-]{43}/,
    );

    // Линкът за управление работи.
    const link = /\/booking\/[A-Za-z0-9_-]{43}/.exec(booking.text)![0];
    const page = await fetch(`${BASE}${link}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Чат Тестов");

    // Паметта на разговора (Postgres Chat Memory) пази предишното съобщение.
    const memory = await chat("Помниш ли какво писах?", booking.cookie);
    expect(memory.text).toMatch(/Помня [1-9]\d* предишни/);
  });
});
