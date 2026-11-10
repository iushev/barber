"use client";

import { useMemo } from "react";

const WEEKDAYS_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Дати "YYYY-MM-DD" без часови зони: цялата аритметика е в UTC. */
function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function isoWeekdayOf(y: number, m: number, d: number) {
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

const longDate = new Intl.DateTimeFormat("bg-BG", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const monthTitle = new Intl.DateTimeFormat("bg-BG", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDateLabel(date: string): string {
  return longDate.format(new Date(`${date}T12:00:00Z`));
}

/**
 * Месечен календар. Активни са само датите от `available` (има свободен час);
 * миналите, почивните и дните без работно време са неактивни.
 */
export function Calendar({
  month,
  onMonthChange,
  available,
  minMonth,
  maxMonth,
  selected,
  onSelect,
}: {
  month: string; // "YYYY-MM"
  onMonthChange: (m: string) => void;
  available: Set<string>;
  minMonth: string;
  maxMonth: string;
  selected: string | null;
  onSelect: (date: string) => void;
}) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const cells = useMemo(() => {
    const lead = isoWeekdayOf(y, m, 1) - 1;
    const total = daysInMonth(y, m);
    return [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: total }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`),
    ];
  }, [y, m]);

  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    onMonthChange(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };
  const title = monthTitle.format(new Date(Date.UTC(y, m - 1, 15)));
  const availableInMonth = cells.filter((c) => c && available.has(c)).length;

  return (
    <div className="max-w-md">
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shift(-1)}
          disabled={month <= minMonth}
          className="border-bone/20 hover:border-brass rounded-sm border px-3 py-2 disabled:opacity-30"
          aria-label="Предишен месец"
        >
          ←
        </button>
        <p className="font-display text-lg tracking-wide uppercase" aria-live="polite">
          {title}
        </p>
        <button
          type="button"
          onClick={() => shift(1)}
          disabled={month >= maxMonth}
          className="border-bone/20 hover:border-brass rounded-sm border px-3 py-2 disabled:opacity-30"
          aria-label="Следващ месец"
        >
          →
        </button>
      </div>
      <div
        className="grid grid-cols-7 gap-1 text-center"
        role="group"
        aria-label={`Дати в ${title}`}
      >
        {WEEKDAYS_SHORT.map((w) => (
          <span key={w} className="text-bone/60 pb-2 text-xs" aria-hidden="true">
            {w}
          </span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <span key={`e${i}`} aria-hidden="true" />;
          const enabled = available.has(date);
          const isSelected = selected === date;
          return (
            <button
              key={date}
              type="button"
              disabled={!enabled}
              onClick={() => onSelect(date)}
              aria-pressed={isSelected}
              aria-label={`${formatDateLabel(date)}${enabled ? "" : " — няма свободни часове"}`}
              className={`aspect-square rounded-sm text-sm tabular-nums transition-colors ${
                isSelected
                  ? "bg-brass text-ink font-bold"
                  : enabled
                    ? "bg-char hover:bg-brass/30 text-bone"
                    : "text-bone/20 cursor-not-allowed"
              } focus-visible:outline-brass focus-visible:outline-2 focus-visible:outline-offset-2`}
            >
              {Number(date.slice(8))}
            </button>
          );
        })}
      </div>
      {availableInMonth === 0 && (
        <p className="text-bone/60 mt-4 text-sm">Няма свободни дати през този месец.</p>
      )}
    </div>
  );
}
