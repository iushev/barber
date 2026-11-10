import "server-only";
/**
 * Изчистване на чат историята в n8n (GDPR).
 *
 * Приложението НЯМА достъп до базата `n8n` (отделни потребители на Postgres), затова
 * изтриването минава през служебен workflow в n8n („chat-purge“, етап 6), който
 * изтрива редовете от таблицата на Postgres Chat Memory по session_id. Webhook-ът е
 * достъпен само във вътрешната мрежа и е защитен със същия Basic Auth като Chat Trigger.
 */
import { env } from "@/config/env";

export type PurgeResult =
  { ok: true; purged: number } | { ok: false; reason: "not_configured" | "failed" };

export async function purgeChatSessions(sessionIds: string[]): Promise<PurgeResult> {
  if (sessionIds.length === 0) return { ok: true, purged: 0 };
  const { N8N_CHAT_PURGE_URL, N8N_CHAT_USER, N8N_CHAT_PASSWORD } = env();
  if (!N8N_CHAT_PURGE_URL || !N8N_CHAT_USER || !N8N_CHAT_PASSWORD) {
    return { ok: false, reason: "not_configured" };
  }
  try {
    const res = await fetch(N8N_CHAT_PURGE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(`${N8N_CHAT_USER}:${N8N_CHAT_PASSWORD}`).toString("base64")}`,
      },
      body: JSON.stringify({ sessionIds }),
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[n8n] изчистването на чат историята върна HTTP ${res.status}`);
      return { ok: false, reason: "failed" };
    }
    return { ok: true, purged: sessionIds.length };
  } catch (err) {
    console.error(
      `[n8n] изчистването на чат историята се провали: ${err instanceof Error ? err.message : err}`,
    );
    return { ok: false, reason: "failed" };
  }
}
