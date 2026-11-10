import "server-only";
/**
 * Автоматично анонимизиране на резервации, по-стари от DATA_RETENTION_MONTHS
 * (обещано в политиката за поверителност). Изпълнява се при отваряне на админ
 * панела, най-много веднъж на час на процес — без отделен cron контейнер.
 */
import { env } from "@/config/env";
import { getDb } from "@/db";
import { purgeChatSessions } from "@/server/n8n";
import { anonymizeBookings } from "./bookings";

const INTERVAL_MS = 3_600_000;
const g = globalThis as unknown as { __retentionLastRun?: number };

export function retentionCutoff(now: Date, months: number): Date {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

export async function runRetentionIfDue(): Promise<void> {
  const nowMs = Date.now();
  if (g.__retentionLastRun && nowMs - g.__retentionLastRun < INTERVAL_MS) return;
  g.__retentionLastRun = nowMs;
  try {
    const res = await anonymizeBookings(getDb(), {
      endedBefore: retentionCutoff(new Date(nowMs), env().DATA_RETENTION_MONTHS),
    });
    if (res.count > 0) {
      await purgeChatSessions(res.chatSessionIds);
      console.log(`[retention] анонимизирани стари резервации: ${res.count}`);
    }
  } catch (err) {
    // Не блокира панела; ще опита отново при следващото отваряне след интервала.
    g.__retentionLastRun = undefined;
    console.error(`[retention] грешка: ${err instanceof Error ? err.message : String(err)}`);
  }
}
