/**
 * Чисти функции (без БД) за изчисляване на свободни часове.
 *
 * Правила:
 * - кандидатите са през `stepMin` минути от началото на работния ден;
 * - услугата трябва да се побира изцяло преди края на деня и да не застъпва почивката;
 * - не застъпва заети интервали (полуотворени [start, end));
 * - не е в миналото и е поне `minLeadMin` минути напред;
 * - датата е между днес и днес + `horizonDays` (в часовата зона на бизнеса).
 */
import { addDaysToDateString, isoWeekday, zonedDateString, zonedToUtc } from "@/server/time";

export interface Interval {
  start: Date;
  end: Date;
}

export interface DaySchedule {
  /** "HH:MM" или "HH:MM:SS" — стенно време в зоната на бизнеса. */
  start: string;
  end: string;
  breakStart: string | null;
  breakEnd: string | null;
}

export interface WeeklyHoursRow {
  weekday: number;
  startTime: string;
  endTime: string;
  breakStart: string | null;
  breakEnd: string | null;
}

export interface ExceptionRow {
  type: "off" | "custom";
  startTime: string | null;
  endTime: string | null;
  breakStart: string | null;
  breakEnd: string | null;
}

export interface SlotRules {
  tz: string;
  stepMin: number;
  minLeadMin: number;
  horizonDays: number;
}

export type DateCheck = { ok: true } | { ok: false; code: "date_in_past" | "date_beyond_horizon" };

/** Работното време за дата: изключението има приоритет пред седмичния график. */
export function resolveDaySchedule(
  date: string,
  weekly: readonly WeeklyHoursRow[],
  exception: ExceptionRow | null | undefined,
): DaySchedule | null {
  if (exception) {
    if (exception.type === "off" || !exception.startTime || !exception.endTime) return null;
    return {
      start: exception.startTime,
      end: exception.endTime,
      breakStart: exception.breakStart,
      breakEnd: exception.breakEnd,
    };
  }
  const row = weekly.find((w) => w.weekday === isoWeekday(date));
  if (!row) return null;
  return {
    start: row.startTime,
    end: row.endTime,
    breakStart: row.breakStart,
    breakEnd: row.breakEnd,
  };
}

export function checkBookingDate(date: string, now: Date, rules: SlotRules): DateCheck {
  const today = zonedDateString(now, rules.tz);
  if (date < today) return { ok: false, code: "date_in_past" };
  if (date > addDaysToDateString(today, rules.horizonDays)) {
    return { ok: false, code: "date_beyond_horizon" };
  }
  return { ok: true };
}

/** Началото на първия допустим час спрямо `now` (минимално предварително време). */
export function earliestBookableStart(now: Date, rules: SlotRules): Date {
  return new Date(now.getTime() + rules.minLeadMin * 60_000);
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export interface ComputeSlotsInput {
  date: string;
  schedule: DaySchedule | null;
  durationMin: number;
  busy: readonly Interval[];
  now: Date;
  rules: SlotRules;
  /** false за администратора: позволява часове в миналото/извън хоризонта. */
  enforceLeadAndHorizon?: boolean;
}

export function computeSlots(input: ComputeSlotsInput): Interval[] {
  const { date, schedule, durationMin, busy, now, rules } = input;
  const enforce = input.enforceLeadAndHorizon ?? true;
  if (!schedule || durationMin <= 0) return [];
  if (enforce && !checkBookingDate(date, now, rules).ok) return [];

  const dayStart = zonedToUtc(date, schedule.start, rules.tz);
  const dayEnd = zonedToUtc(date, schedule.end, rules.tz);
  const breakInterval: Interval | null =
    schedule.breakStart && schedule.breakEnd
      ? {
          start: zonedToUtc(date, schedule.breakStart, rules.tz),
          end: zonedToUtc(date, schedule.breakEnd, rules.tz),
        }
      : null;
  const earliest = earliestBookableStart(now, rules);
  const stepMs = rules.stepMin * 60_000;
  const durMs = durationMin * 60_000;

  const slots: Interval[] = [];
  for (let t = dayStart.getTime(); t + durMs <= dayEnd.getTime(); t += stepMs) {
    const slot = { start: new Date(t), end: new Date(t + durMs) };
    if (enforce && slot.start < earliest) continue;
    if (breakInterval && overlaps(slot, breakInterval)) continue;
    if (busy.some((b) => overlaps(slot, b))) continue;
    slots.push(slot);
  }
  return slots;
}

/** Подрежда кандидатите по близост до `around` и връща първите `limit`. */
export function nearestSlots(
  candidates: readonly Interval[],
  around: Date,
  limit: number,
): Interval[] {
  return [...candidates]
    .sort(
      (a, b) =>
        Math.abs(a.start.getTime() - around.getTime()) -
          Math.abs(b.start.getTime() - around.getTime()) || a.start.getTime() - b.start.getTime(),
    )
    .slice(0, limit)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}
