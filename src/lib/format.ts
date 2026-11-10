import { parsePhoneNumberFromString } from "libphonenumber-js";

export function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("bg-BG", { style: "currency", currency }).format(cents / 100);
}

export function formatDateTime(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("bg-BG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(d);
}

export function formatDate(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("bg-BG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(d);
}

export function formatTime(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("bg-BG", { hour: "2-digit", minute: "2-digit", timeZone }).format(
    d,
  );
}

export function formatPhone(e164: string): string {
  if (!e164) return "—";
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

export const STATUS_LABELS = {
  confirmed: "Потвърдена",
  cancelled: "Отменена",
  completed: "Изпълнена",
  no_show: "Неявил се",
} as const;

export const SOURCE_LABELS = { web: "Сайт", chat: "Чат", admin: "Админ" } as const;

export const WEEKDAY_LABELS = [
  "Понеделник",
  "Вторник",
  "Сряда",
  "Четвъртък",
  "Петък",
  "Събота",
  "Неделя",
] as const;
