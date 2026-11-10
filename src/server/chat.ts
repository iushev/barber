import "server-only";
/**
 * /api/chat — прокси между чат widget-а и n8n Chat Trigger (вътрешната мрежа).
 *
 * Браузър → POST /api/chat { message } → n8n POST {action:"sendMessage", sessionId, chatInput}
 * (Basic Auth). n8n отговаря със стрийм (NDJSON: begin/item/end/error); тук го превеждаме
 * в собствен NDJSON към браузъра: {"type":"delta","text"} … {"type":"done"} | {"type":"error"}.
 *
 * Защити: проверка на Origin (CSRF), Content-Type: application/json, Zod валидация,
 * rate limit по IP (минута/ден) и по сесия (ден) → ограничен разход към OpenAI, таймаут.
 * Съдържанието на съобщенията НЕ се логва.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { env } from "@/config/env";
import { getDb } from "@/db";
import { clientIp, jsonError } from "@/server/http";
import { purgeChatSessions } from "@/server/n8n";
import { consumeRateLimit } from "@/server/ratelimit";

export const CHAT_COOKIE = "barber_chat";
export const CHAT_MAX_LENGTH = 1000;
const SESSION_RE = /^[A-Za-z0-9_-]{32}$/;
const SESSION_TTL_SEC = 24 * 3600;

const FALLBACK = "Чатът временно не е достъпен. Можете да запазите час през формата на сайта.";

const bodySchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Напишете съобщение.")
    .max(CHAT_MAX_LENGTH, `Съобщението е твърде дълго (до ${CHAT_MAX_LENGTH} символа).`),
});

/** Origin трябва да съвпада с публичния адрес или с хоста на заявката (CSRF). */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set<string>([new URL(env().PUBLIC_BASE_URL).origin]);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto =
      req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
    allowed.add(`${proto}://${host}`);
  }
  return allowed.has(origin);
}

function readSession(req: Request): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const m = new RegExp(`(?:^|;\\s*)${CHAT_COOKIE}=([^;]+)`).exec(cookie);
  const value = m?.[1] ? decodeURIComponent(m[1]) : null;
  return value && SESSION_RE.test(value) ? value : null;
}

function sessionCookie(value: string, maxAge: number): string {
  const parts = [
    `${CHAT_COOKIE}=${value}`,
    "Path=/api/chat",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (env().COOKIE_SECURE) parts.push("Secure");
  return parts.join("; ");
}

async function limit(scope: string, id: string, max: number, windowSec: number) {
  return consumeRateLimit(getDb(), { scope, id, limit: max, windowSec });
}

/** Превежда n8n NDJSON стрийма в нашия формат. */
function translateStream(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buffer = "";
  let sentAny = false;
  let failed = false;
  const line = (obj: unknown) => enc.encode(`${JSON.stringify(obj)}\n`);

  const handle = (raw: string, ctrl: TransformStreamDefaultController<Uint8Array>) => {
    const text = raw.trim();
    if (!text) return;
    let msg: { type?: string; content?: string; output?: string };
    try {
      msg = JSON.parse(text) as typeof msg;
    } catch {
      return; // непознат ред — пропускаме
    }
    if (msg.type === "item" && typeof msg.content === "string" && msg.content) {
      sentAny = true;
      ctrl.enqueue(line({ type: "delta", text: msg.content }));
    } else if (msg.type === "error") {
      failed = true;
      ctrl.enqueue(line({ type: "error", message: FALLBACK }));
    } else if (!msg.type && typeof msg.output === "string") {
      // Не-стрийминг режим (responseMode: lastNode) → целият отговор наведнъж.
      sentAny = true;
      ctrl.enqueue(line({ type: "delta", text: msg.output }));
    }
  };

  return upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        buffer += dec.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const l of lines) handle(l, ctrl);
      },
      flush(ctrl) {
        handle(buffer + dec.decode(), ctrl);
        if (failed) return;
        ctrl.enqueue(line(sentAny ? { type: "done" } : { type: "error", message: FALLBACK }));
      },
    }),
  );
}

export async function postChat(req: Request): Promise<Response> {
  if (!isSameOrigin(req))
    return jsonError(403, "forbidden_origin", "Забранен източник на заявката.");
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) {
    return jsonError(415, "unsupported_media_type", "Очаква се JSON.");
  }

  const e = env();
  if (!e.N8N_CHAT_URL || !e.N8N_CHAT_USER || !e.N8N_CHAT_PASSWORD) {
    return jsonError(503, "chat_unavailable", FALLBACK, { fallbackUrl: "/book" });
  }

  const ip = clientIp(req);
  for (const [scope, max, win] of [
    ["chat:ip:min", e.CHAT_RATE_LIMIT_PER_MIN, 60],
    ["chat:ip:day", e.CHAT_RATE_LIMIT_PER_DAY, 86_400],
  ] as const) {
    const rl = await limit(scope, ip, max, win);
    if (!rl.allowed) {
      return jsonError(
        429,
        "rate_limited",
        "Твърде много съобщения. Изчакайте малко или използвайте формата.",
        {
          fallbackUrl: "/book",
        },
        { "Retry-After": String(rl.retryAfterSec) },
      );
    }
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(422, "invalid_json", "Невалидна заявка.");
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(
      422,
      "validation_error",
      parsed.error.issues[0]?.message ?? "Невалидно съобщение.",
    );
  }

  const existing = readSession(req);
  const sessionId = existing ?? randomBytes(24).toString("base64url");
  const sessionRl = await limit("chat:session", sessionId, e.CHAT_MAX_MESSAGES_PER_SESSION, 86_400);
  if (!sessionRl.allowed) {
    return jsonError(
      429,
      "session_limit",
      "Разговорът стана твърде дълъг. Започнете нов разговор или използвайте формата.",
      {
        fallbackUrl: "/book",
      },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(e.N8N_CHAT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(`${e.N8N_CHAT_USER}:${e.N8N_CHAT_PASSWORD}`).toString("base64")}`,
      },
      body: JSON.stringify({ action: "sendMessage", sessionId, chatInput: parsed.data.message }),
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(e.CHAT_TIMEOUT_MS)]),
      cache: "no-store",
    });
  } catch (err) {
    console.error(`[chat] n8n не отговаря: ${err instanceof Error ? err.name : "error"}`);
    return jsonError(503, "chat_unavailable", FALLBACK, { fallbackUrl: "/book" });
  }
  if (!upstream.ok || !upstream.body) {
    console.error(`[chat] n8n върна HTTP ${upstream.status}`);
    await upstream.body?.cancel();
    return jsonError(503, "chat_unavailable", FALLBACK, { fallbackUrl: "/book" });
  }

  const headers = new Headers({
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no",
  });
  if (!existing) headers.append("Set-Cookie", sessionCookie(sessionId, SESSION_TTL_SEC));
  return new Response(translateStream(upstream.body), { status: 200, headers });
}

/** „Нов разговор“: изтрива историята в n8n и cookie-то. */
export async function deleteChat(req: Request): Promise<Response> {
  if (!isSameOrigin(req))
    return jsonError(403, "forbidden_origin", "Забранен източник на заявката.");
  const sessionId = readSession(req);
  if (sessionId) await purgeChatSessions([sessionId]);
  return new Response(null, { status: 204, headers: { "Set-Cookie": sessionCookie("", 0) } });
}
