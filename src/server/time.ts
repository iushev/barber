/**
 * Помощни функции за „стенно“ време в часовата зона на бизнеса.
 * Всички преобразувания локално време ↔ UTC минават оттук (DST-безопасно).
 */
import { TZDate } from "@date-fns/tz";

/** "YYYY-MM-DD" + "HH:MM[:SS]" в зона `tz` → момент във времето (UTC Date). */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi, s] = time.split(":").map(Number);
  return new Date(new TZDate(y!, mo! - 1, d!, h!, mi!, s ?? 0, tz).getTime());
}

/** Календарната дата "YYYY-MM-DD" на момента `at` в зона `tz`. */
export function zonedDateString(at: Date, tz: string): string {
  const z = new TZDate(at.getTime(), tz);
  return `${z.getFullYear()}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}`;
}

/** ISO ден от седмицата (1 = пон … 7 = нед) за календарна дата "YYYY-MM-DD". */
export function isoWeekday(date: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const js = new Date(Date.UTC(y!, mo! - 1, d!)).getUTCDay();
  return js === 0 ? 7 : js;
}

/** Добавя дни към календарна дата "YYYY-MM-DD" (без зависимост от зона). */
export function addDaysToDateString(date: string, days: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y!, mo! - 1, d! + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** ISO 8601 с offset на зоната, напр. "2026-11-12T10:00:00+02:00". */
export function toZonedIso(at: Date, tz: string): string {
  const z = new TZDate(at.getTime(), tz);
  const offsetMin = -z.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return (
    `${z.getFullYear()}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}` +
    `T${pad(z.getHours())}:${pad(z.getMinutes())}:${pad(z.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** "HH:MM" в зона `tz`. */
export function zonedTimeLabel(at: Date, tz: string): string {
  const z = new TZDate(at.getTime(), tz);
  return `${pad(z.getHours())}:${pad(z.getMinutes())}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
