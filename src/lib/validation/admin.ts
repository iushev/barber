import { z } from "zod";
import { dateStringSchema, uuidSchema } from "./booking";

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/, "Часът трябва да е във формат ЧЧ:ММ.")
  .transform((v) => v.slice(0, 5));

const optionalTime = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null))
  .pipe(timeSchema.nullable());

const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal("1"), z.literal(""), z.undefined()])
  .transform((v) => v === "on" || v === "true" || v === "1");

const intField = (min: number, max: number, msg: string) =>
  z.coerce.number({ message: msg }).int(msg).min(min, msg).max(max, msg);

export const barberFormSchema = z.object({
  name: z.string().trim().min(2, "Името е задължително.").max(80, "Името е твърде дълго."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      "Адресът (slug) може да съдържа малки латински букви, цифри и тирета.",
    )
    .max(40),
  bio: z.string().trim().max(600, "Описанието е до 600 символа.").default(""),
  sortOrder: intField(0, 999, "Подредбата трябва да е цяло число от 0 до 999.").default(0),
  serviceIds: z.array(uuidSchema).default([]),
});
export type BarberForm = z.output<typeof barberFormSchema>;

/** Цена като текст ("15", "15.50", "15,50") → центове. */
export const priceToCents = z
  .string()
  .trim()
  .regex(/^\d{1,5}([.,]\d{1,2})?$/, "Цената трябва да е число, напр. 15 или 15.50.")
  .transform((v) => Math.round(Number(v.replace(",", ".")) * 100));

export const serviceFormSchema = z.object({
  name: z.string().trim().min(2, "Името е задължително.").max(80, "Името е твърде дълго."),
  description: z.string().trim().max(600, "Описанието е до 600 символа.").default(""),
  durationMin: intField(5, 480, "Продължителността трябва да е между 5 и 480 минути.").refine(
    (v) => v % 5 === 0,
    "Продължителността трябва да е кратна на 5 минути.",
  ),
  price: priceToCents,
  sortOrder: intField(0, 999, "Подредбата трябва да е цяло число от 0 до 999.").default(0),
});
export type ServiceForm = z.output<typeof serviceFormSchema>;

/** Проверки за интервал с начало/край и незадължителна почивка. */
function checkRange(
  d: {
    start: string | null;
    end: string | null;
    breakStart: string | null;
    breakEnd: string | null;
  },
  ctx: z.RefinementCtx,
) {
  if (!d.start || !d.end) {
    ctx.addIssue({
      code: "custom",
      message: "Въведете начало и край на работното време.",
      path: ["start"],
    });
    return;
  }
  if (d.end <= d.start) {
    ctx.addIssue({ code: "custom", message: "Краят трябва да е след началото.", path: ["end"] });
  }
  if (!!d.breakStart !== !!d.breakEnd) {
    ctx.addIssue({
      code: "custom",
      message: "Почивката изисква и начало, и край.",
      path: ["breakStart"],
    });
  }
  if (d.breakStart && d.breakEnd) {
    if (d.breakEnd <= d.breakStart || d.breakStart < d.start || d.breakEnd > d.end) {
      ctx.addIssue({
        code: "custom",
        message: "Почивката трябва да е в рамките на работното време.",
        path: ["breakStart"],
      });
    }
  }
}

const rangeFields = {
  start: optionalTime,
  end: optionalTime,
  breakStart: optionalTime,
  breakEnd: optionalTime,
};

export const weeklyDaySchema = z
  .object({ enabled: z.boolean(), ...rangeFields })
  .superRefine((d, ctx) => {
    if (d.enabled) checkRange(d, ctx);
  });

export const weeklyScheduleSchema = z.array(weeklyDaySchema).length(7);
export type WeeklyScheduleForm = z.output<typeof weeklyScheduleSchema>;

export const exceptionFormSchema = z
  .object({
    type: z.enum(["off", "custom"], { message: "Изберете вид на изключението." }),
    date: dateStringSchema,
    note: z.string().trim().max(200).default(""),
    ...rangeFields,
  })
  .superRefine((d, ctx) => {
    if (d.type === "custom") checkRange(d, ctx);
  });
export type ExceptionForm = z.output<typeof exceptionFormSchema>;

export const bookingFiltersSchema = z.object({
  from: dateStringSchema.optional().catch(undefined),
  to: dateStringSchema.optional().catch(undefined),
  barberId: uuidSchema.optional().catch(undefined),
  status: z.enum(["confirmed", "cancelled", "completed", "no_show"]).optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
});
export type BookingFilters = z.output<typeof bookingFiltersSchema>;

export const loginSchema = z.object({
  email: z.string().trim().max(254),
  password: z.string().max(1024),
});

export const passwordChangeSchema = z
  .object({
    current: z.string().min(1, "Въведете текущата парола."),
    next: z.string().min(12, "Новата парола трябва да е поне 12 символа.").max(1024),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { message: "Паролите не съвпадат.", path: ["confirm"] });

export { checkbox };
