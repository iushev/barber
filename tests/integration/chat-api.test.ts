import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../src/db/schema";
import { setupFixture, type Fixture } from "../support/fixtures";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
Object.assign(process.env, {
  PUBLIC_BASE_URL: "https://barber.example",
  N8N_CHAT_URL: "http://n8n:5678/webhook/booking-agent/chat",
  N8N_CHAT_PURGE_URL: "http://n8n:5678/webhook/chat-purge",
  N8N_CHAT_USER: "chat",
  N8N_CHAT_PASSWORD: "secret-pass",
  CHAT_RATE_LIMIT_PER_MIN: "3",
  CHAT_RATE_LIMIT_PER_DAY: "100",
  CHAT_MAX_MESSAGES_PER_SESSION: "100",
  COOKIE_SECURE: "true",
  TRUST_PROXY: "false",
});

type Handler = (req: Request) => Promise<Response>;
let fx: Fixture;
let POST: Handler;
let DELETE: Handler;
let closeAppPool: () => Promise<void>;
const realFetch = globalThis.fetch;
const fetchMock = vi.fn<typeof fetch>();

const n8nStream = (lines: object[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        // Нарочно режем по средата на ред, за да проверим буферирането.
        const text = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
        c.enqueue(enc.encode(text.slice(0, 25)));
        c.enqueue(enc.encode(text.slice(25)));
        c.close();
      },
    }),
    { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
  );

beforeAll(async () => {
  fx = await setupFixture();
  ({ POST, DELETE } = await import("@/app/api/chat/route"));
  const { getPool } = await import("@/db");
  closeAppPool = () => getPool().end();
  globalThis.fetch = fetchMock;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await closeAppPool?.();
  await fx?.pool.end();
});

beforeEach(async () => {
  fetchMock.mockReset();
  await fx.db.delete(schema.rateLimits);
});

let ipSeq = 0;
const req = (body: unknown, headers: Record<string, string> = {}, method = "POST") =>
  new Request("https://barber.example/api/chat", {
    method,
    headers: {
      origin: "https://barber.example",
      host: "barber.example",
      "content-type": "application/json",
      "x-forwarded-for": `10.1.0.${++ipSeq}`,
      ...headers,
    },
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });

const readNdjson = async (res: Response) =>
  (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; text?: string; message?: string });

describe("POST /api/chat", () => {
  it("проксира към n8n (формат, Basic Auth) и стриймва отговора; задава session cookie", async () => {
    fetchMock.mockResolvedValueOnce(
      n8nStream([
        { type: "begin", metadata: {} },
        { type: "end", metadata: {} },
        { type: "begin", metadata: {} },
        { type: "item", content: "Здравейте, ", metadata: {} },
        { type: "item", content: "имаме 7 услуги.", metadata: {} },
        { type: "end", metadata: {} },
      ]),
    );
    const res = await POST(req({ message: "  Какви услуги имате?  " }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(
      /^barber_chat=[A-Za-z0-9_-]{32}; Path=\/api\/chat; Max-Age=86400; HttpOnly; SameSite=Lax; Secure$/,
    );

    const events = await readNdjson(res);
    expect(events).toEqual([
      { type: "delta", text: "Здравейте, " },
      { type: "delta", text: "имаме 7 услуги." },
      { type: "done" },
    ]);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://n8n:5678/webhook/booking-agent/chat");
    const headers = new Headers(init!.headers);
    expect(headers.get("authorization")).toBe(
      `Basic ${Buffer.from("chat:secret-pass").toString("base64")}`,
    );
    const sessionId = cookie.split(";")[0]!.split("=")[1];
    expect(JSON.parse(init!.body as string)).toEqual({
      action: "sendMessage",
      sessionId,
      chatInput: "Какви услуги имате?",
    });
  });

  it("преизползва sessionId от cookie-то и не задава ново", async () => {
    fetchMock.mockResolvedValueOnce(n8nStream([{ type: "item", content: "ок" }]));
    const sid = "A".repeat(32);
    const res = await POST(req({ message: "здрасти" }, { cookie: `other=1; barber_chat=${sid}` }));
    expect(res.headers.get("set-cookie")).toBeNull();
    await res.text();
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).sessionId).toBe(sid);
  });

  it("не-стрийминг отговор от n8n ({ output }) също работи", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ output: "Цял отговор" }));
    const events = await readNdjson(await POST(req({ message: "x" })));
    expect(events).toEqual([{ type: "delta", text: "Цял отговор" }, { type: "done" }]);
  });

  it("грешка по време на изпълнението в n8n → error събитие с препратка към формата", async () => {
    fetchMock.mockResolvedValueOnce(
      n8nStream([{ type: "begin" }, { type: "error", content: "OpenAI quota" }]),
    );
    const events = await readNdjson(await POST(req({ message: "x" })));
    expect(events).toEqual([{ type: "error", message: expect.stringContaining("формата") }]);
    // Вътрешната грешка не изтича към клиента.
    expect(JSON.stringify(events)).not.toContain("quota");
  });

  it("n8n недостъпен или с грешка → 503 с fallbackUrl", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const r1 = await POST(req({ message: "x" }));
    expect(r1.status).toBe(503);
    expect(await r1.json()).toMatchObject({
      error: { code: "chat_unavailable", fallbackUrl: "/book" },
    });

    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    expect((await POST(req({ message: "x" }))).status).toBe(503);
  });

  it("CSRF: чужд или липсващ Origin → 403; не-JSON → 415", async () => {
    expect((await POST(req({ message: "x" }, { origin: "https://evil.example" }))).status).toBe(
      403,
    );
    const noOrigin = new Request("https://barber.example/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "x" }),
    });
    expect((await POST(noOrigin)).status).toBe(403);
    expect(
      (await POST(req("message=x", { "content-type": "application/x-www-form-urlencoded" })))
        .status,
    ).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("валидация: празно, твърде дълго, невалиден JSON → 422", async () => {
    for (const body of [{ message: "   " }, { message: "x".repeat(1001) }, { nope: 1 }, "{bad"]) {
      const res = await POST(req(body));
      expect(res.status).toBe(422);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rate limit по IP → 429 с Retry-After (n8n не се вика)", async () => {
    fetchMock.mockImplementation(async () => n8nStream([{ type: "item", content: "ok" }]));
    const ip = { "x-forwarded-for": "10.9.9.9" };
    for (let i = 0; i < 3; i++) expect((await POST(req({ message: "x" }, ip))).status).toBe(200);
    const res = await POST(req({ message: "x" }, ip));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("DELETE /api/chat", () => {
  it("изтрива историята в n8n и cookie-то", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ deleted: 2 }));
    const sid = "B".repeat(32);
    const res = await DELETE(req(null, { cookie: `barber_chat=${sid}` }, "DELETE"));
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://n8n:5678/webhook/chat-purge");
    expect(JSON.parse(init!.body as string)).toEqual({ sessionIds: [sid] });
  });
});
