import { describe, expect, it } from "vitest";
import {
  checkBookingDate,
  computeSlots,
  nearestSlots,
  resolveDaySchedule,
  type DaySchedule,
  type SlotRules,
} from "@/server/slots/compute";
import { toZonedIso, zonedTimeLabel, zonedToUtc } from "@/server/time";

const TZ = "Europe/Sofia";
const rules: SlotRules = { tz: TZ, stepMin: 15, minLeadMin: 60, horizonDays: 60 };
const day: DaySchedule = {
  start: "10:00:00",
  end: "19:00:00",
  breakStart: "13:00:00",
  breakEnd: "14:00:00",
};
// Вторник 2026-11-10, 08:00 местно време (UTC+2).
const NOW = new Date("2026-11-10T06:00:00Z");

const labels = (slots: { start: Date }[]) => slots.map((s) => zonedTimeLabel(s.start, TZ));

describe("computeSlots", () => {
  it("услугата се побира преди почивката и преди края на деня", () => {
    const slots = computeSlots({
      date: "2026-11-11",
      schedule: day,
      durationMin: 45,
      busy: [],
      now: NOW,
      rules,
    });
    const l = labels(slots);
    expect(l[0]).toBe("10:00");
    expect(l).toContain("12:15"); // 12:15–13:00
    expect(l).not.toContain("12:30"); // би застъпил почивката
    expect(l).not.toContain("13:30");
    expect(l).toContain("14:00");
    expect(l.at(-1)).toBe("18:15"); // 18:15–19:00
    expect(l).not.toContain("18:30");
    expect(slots).toHaveLength(10 + 18);
    expect(slots[0]!.start.toISOString()).toBe("2026-11-11T08:00:00.000Z");
  });

  it("стъпка 30 минути", () => {
    const slots = computeSlots({
      date: "2026-11-11",
      schedule: day,
      durationMin: 30,
      busy: [],
      now: NOW,
      rules: { ...rules, stepMin: 30 },
    });
    expect(labels(slots).slice(0, 3)).toEqual(["10:00", "10:30", "11:00"]);
    expect(slots).toHaveLength(6 + 10);
  });

  it("изключва заетите интервали (полуотворени)", () => {
    const busy = [
      { start: zonedToUtc("2026-11-11", "11:00", TZ), end: zonedToUtc("2026-11-11", "11:30", TZ) },
    ];
    const l = labels(
      computeSlots({ date: "2026-11-11", schedule: day, durationMin: 45, busy, now: NOW, rules }),
    );
    expect(l).toContain("10:15"); // 10:15–11:00 докосва, но не застъпва
    expect(l).not.toContain("10:30");
    expect(l).not.toContain("11:00");
    expect(l).not.toContain("11:15");
    expect(l).toContain("11:30");
  });

  it("не предлага часове в миналото и по-близо от минималното време", () => {
    const now = new Date("2026-11-10T08:20:00Z"); // 10:20 местно
    const l = labels(
      computeSlots({ date: "2026-11-10", schedule: day, durationMin: 30, busy: [], now, rules }),
    );
    expect(l[0]).toBe("11:30"); // най-рано 11:20 → следващата стъпка
  });

  it("минала дата и дата извън хоризонта → няма часове", () => {
    const base = { schedule: day, durationMin: 30, busy: [], now: NOW, rules };
    expect(computeSlots({ ...base, date: "2026-11-09" })).toEqual([]);
    expect(computeSlots({ ...base, date: "2027-01-09" })).not.toEqual([]); // днес + 60
    expect(computeSlots({ ...base, date: "2027-01-10" })).toEqual([]); // днес + 61
  });

  it("администраторът може да игнорира хоризонта и минималното време", () => {
    const slots = computeSlots({
      date: "2026-11-10",
      schedule: day,
      durationMin: 30,
      busy: [],
      now: new Date("2026-11-10T15:00:00Z"),
      rules,
      enforceLeadAndHorizon: false,
    });
    expect(labels(slots)[0]).toBe("10:00");
  });

  it("почивен ден → няма часове", () => {
    expect(
      computeSlots({
        date: "2026-11-11",
        schedule: null,
        durationMin: 30,
        busy: [],
        now: NOW,
        rules,
      }),
    ).toEqual([]);
  });

  it("смяна на часовото време (DST)", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const short: DaySchedule = { start: "10:00", end: "12:00", breakStart: null, breakEnd: null };
    const sat = computeSlots({
      date: "2026-03-28",
      schedule: short,
      durationMin: 30,
      busy: [],
      now,
      rules,
    });
    const sun = computeSlots({
      date: "2026-03-29",
      schedule: short,
      durationMin: 30,
      busy: [],
      now,
      rules,
    });
    expect(sat[0]!.start.toISOString()).toBe("2026-03-28T08:00:00.000Z"); // UTC+2
    expect(sun[0]!.start.toISOString()).toBe("2026-03-29T07:00:00.000Z"); // UTC+3
    expect(toZonedIso(sun[0]!.start, TZ)).toBe("2026-03-29T10:00:00+03:00");
    expect(sun).toHaveLength(7);

    const nowOct = new Date("2026-10-01T00:00:00Z");
    const oct24 = computeSlots({
      date: "2026-10-24",
      schedule: short,
      durationMin: 30,
      busy: [],
      now: nowOct,
      rules,
    });
    const oct25 = computeSlots({
      date: "2026-10-25",
      schedule: short,
      durationMin: 30,
      busy: [],
      now: nowOct,
      rules,
    });
    expect(oct24[0]!.start.toISOString()).toBe("2026-10-24T07:00:00.000Z");
    expect(oct25[0]!.start.toISOString()).toBe("2026-10-25T08:00:00.000Z");
    expect(labels(oct25)).toEqual(["10:00", "10:15", "10:30", "10:45", "11:00", "11:15", "11:30"]);
  });
});

describe("resolveDaySchedule", () => {
  const weekly = [
    { weekday: 3, startTime: "10:00", endTime: "19:00", breakStart: null, breakEnd: null },
  ];
  it("седмичен график по ISO ден", () => {
    expect(resolveDaySchedule("2026-11-11", weekly, null)?.start).toBe("10:00"); // сряда
    expect(resolveDaySchedule("2026-11-12", weekly, null)).toBeNull(); // четвъртък
  });
  it("изключението има приоритет", () => {
    const off = {
      type: "off" as const,
      startTime: null,
      endTime: null,
      breakStart: null,
      breakEnd: null,
    };
    const custom = {
      type: "custom" as const,
      startTime: "09:00",
      endTime: "12:00",
      breakStart: null,
      breakEnd: null,
    };
    expect(resolveDaySchedule("2026-11-11", weekly, off)).toBeNull();
    expect(resolveDaySchedule("2026-11-12", weekly, custom)?.end).toBe("12:00");
  });
});

describe("checkBookingDate", () => {
  it("днес е позволено; вчера и след хоризонта — не", () => {
    expect(checkBookingDate("2026-11-10", NOW, rules)).toEqual({ ok: true });
    expect(checkBookingDate("2026-11-09", NOW, rules)).toEqual({ ok: false, code: "date_in_past" });
    expect(checkBookingDate("2027-01-10", NOW, rules)).toEqual({
      ok: false,
      code: "date_beyond_horizon",
    });
  });
  it("„днес“ се определя в часовата зона на бизнеса", () => {
    // 23:30 UTC на 10.11 = 01:30 на 11.11 в София
    expect(checkBookingDate("2026-11-10", new Date("2026-11-10T23:30:00Z"), rules)).toEqual({
      ok: false,
      code: "date_in_past",
    });
  });
});

describe("nearestSlots", () => {
  it("връща най-близките, подредени хронологично", () => {
    const mk = (h: number) => ({
      start: new Date(Date.UTC(2030, 0, 1, h)),
      end: new Date(Date.UTC(2030, 0, 1, h, 30)),
    });
    const around = new Date(Date.UTC(2030, 0, 1, 12));
    const r = nearestSlots([mk(8), mk(11), mk(13), mk(14), mk(17)], around, 3);
    expect(r.map((s) => s.start.getUTCHours())).toEqual([11, 13, 14]);
  });
});
